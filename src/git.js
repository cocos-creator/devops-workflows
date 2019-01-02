
// operations on local git repo
// copied from https://github.com/cocos-creator/fireball/blob/35a063610da706d4a157c35a7e622f1d1fa1f181/utils/libs/git.js
'use strict';

var Path = require('path');
var Chalk = require('chalk');
var Spawn = require('child_process').spawn;
var treekill = require('tree-kill');

function exec(cmdArgs, path, cb, options) {
    var timeout = (options && options.timeout) || 600000;
    var autoRetry = options && options.autoRetry;
    var autoKill = !options || (options.autoKill !== false);

    console.log(Chalk.yellow('git ' + cmdArgs.join(' ')), 'in', Chalk.magenta(path));

    var child = Spawn('git', cmdArgs, {
        cwd: path,
        stdio: [0, 'pipe', 'pipe']
    });

    var offbranch = false;
    var aborted = false;
    var timerId = -1;

    function retry () {
        console.log(Chalk.yellow(`restart "${cmdArgs[0]}": ${Path.basename(path)}`));
        exec(cmdArgs, path, cb, options); // Object.assign({}, options, { autoRetry: false })
    }

    function onConnectionError () {
        aborted = true;
        clearTimeout(timerId);
        console.log(Chalk.yellow(`connection timeout/error: ${Path.basename(path)}`));
        treekill(child.pid);
        if (autoRetry && !offbranch) {
            retry();
        }
        else {
            // console.log('+++send callback from connection timeout: ' + Path.basename(path));
            cb(null, { offbranch });
        }
    }

    timerId = setTimeout(onConnectionError, timeout);

    child.stdout.on('data', function (data) {
        if (aborted) return;

        var text = path + ' ' + data.toString().trim();

        // git stash pop
        if (text.indexOf('CONFLICT (content): Merge conflict in') !== -1) {
            console.error(Chalk.red(text));
            process.exit(1);
            return;
        }
    });
    child.stderr.on('data', function(data) {
        if (aborted) return;

        var text = path + ' ' + data.toString().trim();

        // git checkout ("overwritten by checkout")
        // git pull ("overwritten by merge")
        if (text.includes('Your local changes to the following files would be overwritten by')) {
            if (!autoKill) {
                console.log(Chalk.yellow(text));
                clearTimeout(timerId);
                aborted = true;
                return cb(new Error(text));
            }
        }

        // git pull ("error: cannot lock ref '...': ... (unable to update local ref)")
        if (text.includes('error: cannot lock ref')) {
            console.log(Chalk.yellow(text));
            aborted = true;
            setTimeout(retry, 500);
            return;
        }

        if (text.includes('Aborting') || text.includes('fatal')) {
            if (
                text.indexOf('Invalid refspec') === -1 &&
                text.indexOf('Couldn\'t find remote ref') === -1 &&
                text.indexOf('remote fireball already exists') === -1
            ) {
                if (text.includes('Could not read from remote repository') ||
                    text.includes('The remote end hung up unexpectedly')
                ) {
                    console.log(Chalk.yellow(text));
                    onConnectionError();
                }
                else {
                    console.error(Chalk.red(text));
                    process.exit(1);
                }
                return;
            }

            offbranch = true;
        }

        // normal message, not error
        console.log(text);
    });
    if (cb) {
        child.on('close', function (code, signal) {
            if (aborted) return;
            // console.log(`====closing process: ${Path.basename(path)}, code: ${code}, signal: ${signal}`);
            clearTimeout(timerId);
            // console.log('+++send callback from close event: ' + Path.basename(path));
            cb (null, { offbranch });
        });
    }
}

module.exports = {
    exec
};
