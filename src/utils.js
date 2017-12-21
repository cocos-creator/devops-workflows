
const { resolve } = require('path');
const { spawn } = require('child_process');

function getSettings () {
    const defaultsDeep = require('lodash/defaultsDeep');
    const mapValues = require('lodash/mapValues');
    const defaultSettings = require('../package.json').workflows_settings;
    const customSettings = require('../custom_settings');

    // inherit settings
    defaultsDeep(customSettings, defaultSettings);

    // resolve paths
    customSettings.paths = mapValues(customSettings.paths, x => resolve('../custom_settings', x));

    return customSettings;
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

module.exports = {
    getSettings,
    gulp,
};
