#!/usr/bin/env node
'use strict';

const request = require('request');
const fs = require('fs');
const TZ_US_CENTRAL = 'US/Central';
const moment = require('moment-timezone');
const os = require('os');
const debug = require('debug')('wind');
const mkdirp = require('mkdirp');
const exec = require('child_process').exec;
const async = require('async');
const path  = require('path');
const args = process.argv.slice(2);
const uuid = require('uuid');
const tmpDir = os.tmpdir();
const querystring = require('querystring');
const intersect = require('@turf/intersect');
const statesLayer = JSON.parse(fs.readFileSync(path.join(__dirname, 'states', 'states.geojson'), 'utf8'));

function rmdir(dir, cb) {
  var rmdirCMD = 'rm -R ' + dir;
  fs.exists(dir, function(res) {
    if (!res) {
      return cb();
    }
    return exec(rmdirCMD, cb);
  });
}

function downloadFile(url, dest, cb) {
  debug('download ' + url);
  request.get( url )
    .on('error', cb)
    .on('response', function( res ){
      if (res.statusCode !== 200) {
        return cb(new Error('Http Error', 200));
      }
      var fws = fs.createWriteStream( dest);

      fws.on('error', function (e) {
        cb(e);
      });

      res.pipe( fws );

      fws.on('finish', function () {
        cb(null, dest);
      });
    });
}

function generateLayerForStates(states, date, dest, options, cb) {
  const tmpFile = path.join(path.join(tmpDir, uuid.v1() + '.csv'));
  const serverUrl = options.serverUrl;
  
  async.series([
      function(next) {
        var query = querystring.stringify({
          states: states, 
          date: date.format('YYYY-MM-DD')
        });
        return downloadFile(serverUrl + '/api/wind?' + query , tmpFile, next);
      },
      function(next) {
        const levels = options.levels;
        const cpuTimeLimit = options.cpuTimeLimit;
        var cmd = 'python ' + path.join(__dirname,  'contour.py') + ' -f GeoJSON -a wind -l "' + levels + '"';
        if (cpuTimeLimit > -1) {
          cmd += ' -tl ' + cpuTimeLimit;
        }
        cmd += ' ' + tmpFile + ' ' + dest;
        console.log(cmd);
        debug(cmd);
        exec(cmd, next);
      }
  ], function(err) {
      debug('unlink', tmpFile)
      //fs.unlink(tmpFile, function() {});
      cb(err, dest);
  });
}

function clipByStates(input, output, states) {
  debug('clip by states');
  const windLayer = JSON.parse(fs.readFileSync(input, 'utf8'));

  statesLayer.features.forEach((stateFeature) => {
    if (states && states.indexOf(stateFeature.properties.STATE_ABBR.toLowerCase()) == -1) {
      return;
    }

    const conflictLayer = {
      "type": "FeatureCollection",
      "crs": { "type": "name", "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      "features": []
    };

    windLayer.features.reduce((prev, windFeature) => {
      try {
        var conflict = intersect(stateFeature, windFeature);
        if (conflict) {
          conflict.properties = windFeature.properties;
          prev.push(conflict);
        }
      } catch(e) {
        console.log('Clip by state ' + stateFeature.properties.STATE_NAME + ':', e.message);
      }
      
      return prev;
    }, conflictLayer.features);

    if (!conflictLayer.features.length) {
      return;
    }
    var dest = output.replace('%state%', stateFeature.properties.STATE_ABBR);
    fs.writeFileSync(dest, JSON.stringify(conflictLayer), "utf8");
  }, []);
}


(function() {
  const serverUrl = "http://sams.mapforensics.com";
  const date = moment.parseZone(args[0]);
  const outdir = args[1] ||  path.join(os.tmpdir(), 'wind');
  const cpuTimeLimit = parseInt(args[2]);
  const states = ["al", "ak", "az", "ar", "ca", "co", "nj", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", 
  "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy"];
  const excludedStates = ["ak", "hi"];
  var generateForStates = states.filter(function(state) {
    return excludedStates.indexOf(state) == -1;
  });
  const levels = [/*1, 4, 8, 13, 19, 25, 32,*/ 39, 47, 55, 64, 73].join(',');
  const globalStatesLayerDest = path.join(outdir, 'global_wind_speed_plot.json');

  async.series([
    function(next) {
      rmdir(outdir, next);
    },
    function(next) {
      debug(path.join(outdir, 'state'));
      mkdirp(path.join(outdir, 'state'), next);
    },
    function(next) {  //generate for all states
      var options = {
        levels: levels, 
        serverUrl: serverUrl,
        cpuTimeLimit: cpuTimeLimit
      };
      generateLayerForStates(generateForStates, date, globalStatesLayerDest, options, function(err) {
        if (err) {
          console.error('Failed to generate wind layer', err);
        } else {
          debug('global layer for states generated');
        }
        next(err);
      });
    },
    function(next) {  //generate for excluded states
      async.eachSeries(excludedStates, function(state, done) {
        var dest = path.join(outdir, state.toUpperCase() + '_wind_speed_plot.json');
        var options = {
          levels: levels, 
          serverUrl: serverUrl,
          cpuTimeLimit: cpuTimeLimit
        };
        generateLayerForStates([state], date, dest, options, function(err) {
          if (err){
            console.error('Failed to generate wind layer', err);
          } else {
            debug('layer for state "' + state.toUpperCase() + '" generated');
          }
          done();
        });
      }, next);
    },
    function(next) {  //crop layer by states
      try{
        clipByStates(globalStatesLayerDest, path.join(outdir, "state/%state%_wind_speed_plot.json"), generateForStates);
        next();
      } catch(e) {
        next(e);
      }
    },
    function(next) {  //crop excluded states
      async.eachSeries(excludedStates, function(state, done) {
        var layer = path.join(outdir, state.toUpperCase() + '_wind_speed_plot.json');
        try{
          clipByStates(layer, path.join(outdir, "state/%state%_wind_speed_plot.json"), [state]);
          done();
        } catch(e) {
          done(e);
        }
      }, next);
    }
  ], function(err) {
    if (err) {
      console.error(err);
      process.exit(1);
    } else {
      process.exit(0);
    }
  });
}());

