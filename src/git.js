
// operations on local git repo
// copied from https://github.com/cocos-creator/fireball/blob/35a063610da706d4a157c35a7e622f1d1fa1f181/utils/libs/git.js

var Path = require('path');
var Chalk = require('chalk');
var Spawn = require('child_process').spawn;
var treekill = require('tree-kill');

function exec (cmdArgs, path, cb, options) {
    var timeout = (options && options.timeout) || 500000;
    var autoRetry = options && options.autoRetry;

    console.log(Chalk.yellow('git ' + cmdArgs.join(' ')), 'in', Chalk.magenta(path));

    var child = Spawn('git', cmdArgs, {
        cwd: path,
        stdio: [0, 'pipe', 'pipe']
    });

    var offbranch = false;
    var aborted = false;

    function onConnectionError () {
        aborted = true;
        console.log(Chalk.yellow(`connection timeout/error: ${Path.basename(path)}`));
        treekill(child.pid);
        if (autoRetry && !offbranch) {
            console.log(Chalk.yellow(`restart "${cmdArgs[0]}": ${Path.basename(repo)}`));
            exec(cmdArgs, path, cb, options); // Object.assign({}, options, { autoRetry: false })
        }
        else {
            // console.log('+++send callback from connection timeout: ' + Path.basename(path));
            cb(null, { offbranch });
        }
    }

    var timerId = setTimeout(onConnectionError, timeout);

    child.stdout.on('data', function (data) {
        if (aborted) return;
        process.stdout.write(path + ' ');

        var text = data.toString();

        // git stash pop
        if (text.indexOf('CONFLICT (content): Merge conflict in') !== -1) {
            process.stderr.write(Chalk.red(text));
            process.exit(1);
            return;
        }
    });
    child.stderr.on('data', function(data) {
        if (aborted) return;
        process.stderr.write(path + ' ');

        var text = data.toString();

        // git checkout
        if (text.indexOf('Your local changes to the following files would be overwritten by checkout') !== -1) {
            process.stderr.write(Chalk.yellow(text));
            clearTimeout(timeout);
            aborted = true;
            return cb(new Error(text));
        }

        if (
            text.indexOf('Aborting') !== -1  ||
            text.indexOf('fatal') !== -1
        ) {
            if (
                text.indexOf('Invalid refspec') === -1 &&
                text.indexOf('Couldn\'t find remote ref') === -1 &&
                text.indexOf('remote fireball already exists') === -1
            ) {
                process.stderr.write(Chalk.red(text));
                if (text.indexOf('Could not read from remote repository') === -1) {
                    process.exit(1);
                }
                else {
                    clearTimeout(timerId);
                    onConnectionError();
                }
                return;
            }

            offbranch = true;
        }

        process.stderr.write(Chalk.green(text));
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
