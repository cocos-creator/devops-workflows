
const Download = require('download');
const { join, basename } = require('path');
const { parse } = require('url');
const del = require('del');
const globby = require('globby');
const fse = require('fs-extra');
const program = require('commander');
const Chalk = require('chalk');
const ProgressBar = require('progress');

const { getSettings, tooltip, sleep } = require('./utils');
const unzip = require('./unzip');

const TempDir = '.downloading';

var httpProxies = getSettings().httpProxies;

program
    .option('--url <url>')
    .option('--dir <path>')
    .option('--reserveZipRootDir')
    .parse(process.argv);

async function download(url, dir, retryTimes = 5) {
    let isLan = parse(url).hostname.startsWith('192.168.');
    let proxy = (!isLan && httpProxies.length > 0) ? httpProxies[0] : undefined;

    if (proxy) {
        tooltip(Chalk.grey(`downloading "${Chalk.white(url)}" via proxy ${proxy}`));
    }
    else {
        tooltip(Chalk.grey(`downloading "${Chalk.white(url)}"`));
    }

    let args = {
        filename: basename(url),
        mode: '755',
        extract: false,        // 文件如果太大，不能用 node.js 解压，不然各种奇葩 bug
        strip: 0,
        proxy
    };

    if (!proxy) {
        args.agent = null;     // 强制禁用 proxy 参数，否则会读取到 npm 设置的参数，导致无法下载内网资源
    }
    var timer = null;
    try {
        var bar = new ProgressBar('[  downloaded: :downloaded MB speed: :speed KB/S lasting: :last ]', { 
            incomplete: ' ',
            width: 40,
            total: 100 
        });
        var lastBytes = 0;
        var total = 0;
        var duration = 0;
        timer = setInterval(() => {
            var delta = total - lastBytes;
            lastBytes = total;
            var speed = (delta / 1024).toFixed(2);
            duration++;
            bar.render({downloaded: (total / 1048576).toFixed(2), speed: speed, last: Math.floor(duration / 60) + ' min ' + duration % 60 + ' s'});
        }, 1000);

        await Download(url, dir, args).on('downloadProgress', progress => {
            total = progress.transferred;
        });
        
        clearInterval(timer);
    }
    catch (err) {
        clearInterval(timer);
        if (err.statusCode !== 404) {
            if (err.code === 'ECONNRESET' && proxy) {
                // proxy error
                var currentProxy = httpProxies.length > 0 ? httpProxies[0] : undefined;
                var proxyChanged = proxy !== currentProxy;
                if (!proxyChanged) {
                    httpProxies.shift();
                    if (httpProxies.length > 0) {
                        tooltip.pin(Chalk.grey(`switch proxy to ${Chalk.white(httpProxies[0])}`));
                    }
                    else {
                        tooltip.pin(Chalk.yellow(`bypass all proxies`));
                    }
                }
                await download(url, dir, retryTimes);
                return;
            }
            else if (retryTimes > 0) {
                tooltip.pin(Chalk.yellow(`retry download "${url}" - ${retryTimes - 1}`));
                await download(url, dir, retryTimes - 1);
                return;
            }
        }
        tooltip.pin();
        throw err;
    }

    // success
    tooltip.clear();
}

// download zip and extract it
// see http://Cocos.quickconnect.to/oo/r/458125396699783206
(async function () {
    let url = program.url;
    let dir = program.dir;
    if (!url || !dir) {
        console.error('Invalid parameter');
        process.exit(1);
    }

    let tmpDir = join(dir, TempDir);

    // clear
    await del(tmpDir, { force: true });

    // download
    await download(url, tmpDir);

    // unzip
    let zipFile = join(tmpDir, basename(url));
    tooltip(Chalk.grey(`unzipping "${Chalk.white(zipFile)}"`));
    try {
        await unzip(zipFile, tmpDir);
    }
    catch (err) {
        tooltip.pin();
        throw err;
    }
    await del(zipFile, { force: true });
    tooltip.clear();

    // strip directory manually

    let copyFrom = tmpDir;
    let rootFiles = await globby(['*', '!__MACOSX'], { cwd: tmpDir, onlyFiles: false });
    if (rootFiles.length === 0) {
        console.error(`No file extracted from ${url}`);
        process.exit(1);
    }
    else if (rootFiles.length === 1 && !program.reserveZipRootDir) {
        let rootFile = join(tmpDir, rootFiles[0]);
        if ((await fse.stat(rootFile)).isDirectory()) {
            // 已经自带一个跟目录，剔除这个根目录
            console.log(`Remove duplicated directory "${rootFile}" extracted from ${url}.`);
            copyFrom = rootFile;
        }
    }

    let files = await globby(['*', '!__MACOSX'], { cwd: copyFrom, onlyFiles: false, dot: true });
    for (let i = 0; i < files.length; ++i) {
        let filename = files[i];
        await fse.move(join(copyFrom, filename), join(dir, filename), { overwrite: true });
    }

    // purge

    await del(tmpDir, { force: true });
    await sleep(50);    // ensure handle released on Windows
})();
