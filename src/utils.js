
const { resolve } = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

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
    var child = spawn(getCmd('gulp'), args, {
        cwd: cwd,
        stdio: 'inherit'
    });
    child.on('exit', function () {
        console.log('Finish running gulp in', cwd);
        return callback();
    });
}

function getCmd (cmd) {
    return process.platform === 'win32' ? (cmd + '.cmd') : cmd;
}

function tooltip (text) {
    readline.cursorTo(process.stdout, 0);
    process.stdout.write('' + (text || ''));
}
tooltip.clear = function () { tooltip(); };
tooltip.pin = function (text) {
    if (text) {
        tooltip.clear();
        console.log(text);
    }
    else {
        process.stdout.write('\n');
    }
};

function sleep (ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

module.exports = {
    getSettings,
    getCmd,
    gulp,
    tooltip,
    sleep,
};
