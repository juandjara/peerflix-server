'use strict';

var fs = require('fs'),
  path = require('path'),
  events = require('events'),
  _ = require('lodash'),
  mkdirp = require('mkdirp'),
  readTorrent = require('read-torrent'),
  engine = require('./engine'),
  homePath = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'],
  configPath = path.join(homePath, '.config', 'peerflix-server'),
  configFile = path.join(configPath, 'config.json'),
  storageFile = path.join(configPath, 'torrents.json'),
  torrents = {},
  options = {};
var https = require('https');
require('dotenv').config();

function save() {
  mkdirp(configPath, function (err) {
    if (err) {
      throw err;
    }
    var state = Object.keys(torrents).map(function (infoHash) {
      return {infoHash: infoHash, addDate: torrents[infoHash].addDate};
    });
    fs.writeFile(storageFile, JSON.stringify(state), function (err) {
      if (err) {
        throw err;
      }
      console.log('current state saved');
    });
  });
}

// sendNotificationToTelegram({test: "test"}).then(res => res.toString()).then(res => console.log(res), err => console.error(err))

function sendNotificationToTelegram(torrent) {
  const msg = JSON.stringify(torrent, null, 2);
  const path = `/bot${encodeURIComponent(process.env.BOT_TOKEN)}/sendMessage?chat_id=${process.env.TG_CHANNEL}&text=${encodeURIComponent(msg)}`;
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: (path),
      method: 'GET'
    }, res => {
      res.on('data', data => {
        resolve(data);
      })
    })
    request.on('error', err => {
      reject(err);
    })
    request.end();
  })
}

var store = _.extend(new events.EventEmitter(), {
  add: function (link, callback) {
    readTorrent(link, function (err, torrent) {
      if (err) {
        return callback(err);
      }
      var infoHash = torrent.infoHash;
      if (torrents[infoHash]) {
        return callback(null, infoHash);
      }

      console.log('adding ' + infoHash);

      try {
        var e = engine(torrent, options);
        e.addDate = Date.now();
        store.emit('torrent', infoHash, e);
        torrents[infoHash] = e;
        save();
        callback(null, infoHash);
        sendNotificationToTelegram(e);
      } catch (e) {
        callback(e);
      }
    });
  },
  get: function (infoHash) {
    return torrents[infoHash];
  },
  remove: function (infoHash) {
    var torrent = torrents[infoHash];
    torrent.destroy();
    torrent.remove(function () {
      torrent.emit('destroyed');
    });
    delete torrents[infoHash];
    save();
  },
  list: function () {
    return Object.keys(torrents).map(function (infoHash) {
      return torrents[infoHash];
    });
  },
  load: function (torrentData) {
		var infoHash = torrentData.infoHash;
    console.log('loading ' + infoHash);
    var e = engine({ infoHash: infoHash });
		e.addDate = torrentData.addDate;
    store.emit('torrent', infoHash, e);
    torrents[infoHash] = e;
  }
});

mkdirp(configPath, function (err) {
  if (err) {
    throw err;
  }
  fs.readFile(configFile, function (err, data) {
    if (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    } else {
      options = JSON.parse(data);
      console.log('options: ' + JSON.stringify(options));
    }

    fs.readFile(storageFile, function (err, data) {
      if (err) {
        if (err.code === 'ENOENT') {
          console.log('previous state not found');
        } else {
          throw err;
        }
      } else {
        var torrents = JSON.parse(data);
        console.log('resuming from previous state');
        torrents.forEach(function (torrentData) {
          store.load(torrentData);
        });
      }
    });
  });
});

function shutdown(signal) {
  if (signal) {
    console.log(signal);
  }

  var keys = Object.keys(torrents);
  if (keys.length) {
    var key = keys[0], torrent = torrents[key];
    torrent.destroy(function () {
      torrent.emit('destroyed');
      delete torrents[key];
      process.nextTick(shutdown);
    });
  } else {
    process.nextTick(process.exit);
  }
}

process.on('SIGTERM', function () {
  shutdown('SIGTERM');
});

process.on('SIGINT', function () {
  shutdown('SIGINT');
});

module.exports = store;
