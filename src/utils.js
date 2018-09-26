
const { resolve } = require('path');
const { spawn } = require('child_process');

function getSettings () {
    const defaultsDeep = require('lodash/defaultsDeep');
    const mapValues = require('lodash/mapValues');
    const defaultSettings = require('../package.json').workflows_settings;
    let settings;
    try {
        settings = require('../settings');
    }
    catch (e) {}

    if (settings) {
    // inherit settings
        defaultsDeep(settings, defaultSettings);
    }
    else {
        settings = defaultSettings;
    }

    // resolve paths
    settings.paths = mapValues(settings.paths, x => resolve('../settings', x));

    return settings;
}

function gulp (args, cwd, callback) {
    console.log('Start running gulp', args.join(' '), 'in', cwd);
    var cmd = process.platform === 'win32' ? 'gulp.cmd' : 'gulp';
    var child = spawn(cmd, args, {
        cwd: cwd,
        stdio: 'inherit'
    });
    child.on('exit', function () {
        console.log('Finish running gulp in', cwd);
        return callback();
    });
}

function tooltip (text) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write('' + (text || ''));
}
tooltip.clear = function () { tooltip(); };
tooltip.pin = function () { process.stdout.write('\n'); };

module.exports = {
    getSettings,
    gulp,
    tooltip
};
