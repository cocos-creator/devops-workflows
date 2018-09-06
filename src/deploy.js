
const { promisify } = require('util');
const { dirname, basename, join, isAbsolute } = require('path');
const program = require('commander');
const ftp = require('ftp');
const pick = require('lodash/pick');
var Chalk = require('chalk');

const { tooltip } = require('./utils');

program
    .command('upload <file>')
    .option('--dest <path>', 'Specify the dest path to upload')
    .option('--user <username>', 'Username for authentication')
    .option('--password <password>', 'Password for authentication')
    .option('--host <host>', 'The hostname or IP address of the FTP server')
    .option('--archieve-same-version', 'Auto archieve same version files before uploading')
    .action(upload2Ftp);

program.parse(process.argv);

function getFilesToArchieve (list, myFile) {
    const LHS_PatchVerAndDate_RHS = /(.+[.\-_]+[v]?\d+(?:\.\d+)+)([.\-_]+[a-z]+(?:[.\-_]\d+|\d*)(?:[.\-_]\d+)?)(.*\..+)/i;
    let matches = myFile.match(LHS_PatchVerAndDate_RHS);
    if (matches) {
        let myLHS = matches[1];
        let myRHS = matches[3];
        return list.filter(x => {
            let matches = x.match(LHS_PatchVerAndDate_RHS);
            if (matches) {
                let lhs = matches[1];
                let rhs = matches[3];
                return (lhs === myLHS && rhs === myRHS);
            }
            else {
                return false;
            }
        });
    }
    else {
        return [];
    }
}

async function upload2Ftp(localPath, options, callback) {
    let remotePath = options.dest;
    if (!isAbsolute(remotePath)) {
        remotePath = '/' + remotePath;
    }
    let remoteDir = dirname(remotePath);
    let client = new ftp();
    client.on('error', function (err) {
        tooltip.pin();
        if (err) {
            console.error(err);
        }
        process.exit(1);
    });

    tooltip(`Connecting to ${options.host}`);
    let connect = promisify(client.on.bind(client))('ready');
    client.connect(pick(options, ['host', 'user', 'password']));
    await connect;

    tooltip(`mkdir ${remoteDir}`);
    try {
        await promisify(client.mkdir.bind(client))(remoteDir, true);

        if (options.archieveSameVersion) {
            tooltip.clear();
            let files = await promisify(client.listSafe.bind(client))(remoteDir);
            let sameVersionFiles = getFilesToArchieve(files.map(x => x.name), basename(remotePath));
            for (let i = 0; i < sameVersionFiles.length; ++i) {
                let oldFile = sameVersionFiles[i];
                let oldPath = join(remoteDir, oldFile);
                let newPath = join(remoteDir, '..', 'Histroy', oldFile);

                console.log(`move ${oldPath} to ${newPath}`);
                try {
                    await promisify(client.delete.bind(client))(newPath);
                }
                catch (e) {}
                await promisify(client.mkdir.bind(client))(dirname(newPath), true);
                await promisify(client.rename.bind(client))(oldPath, newPath);
            }
        }

        tooltip(`Uploading ${localPath} to ${remotePath}`);
        await promisify(client.put.bind(client))(localPath, remotePath);
    }
    catch (e) {
        tooltip.pin();
        console.error(e);
        process.exit(1);
    }

    client.end();
    client.destroy();

    tooltip.clear();
    console.log(`${localPath} uploaded to ${options.host}${remotePath} successfully.`);

    callback && callback();
}

module.exports = {
    upload2Ftp,
};
