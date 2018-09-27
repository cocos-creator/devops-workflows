
const Download = require('download');
const { join } = require('path');
const del = require('del');
const globby = require('globby');
const fse = require('fs-extra');
const program = require('commander');
const Chalk = require('chalk');

const { getSettings, tooltip } = require('./utils');

const TempDir = '.downloading';

var httpProxies = getSettings().httpProxies;

program
    .option('--url <url>')
    .option('--dir <path>')
    .parse(process.argv);

async function download(url, dir, retryTimes = 5) {
    let proxy = httpProxies.length > 0 ? httpProxies[0] : undefined;

    if (proxy) {
        tooltip(Chalk.grey(`downloading "${Chalk.white(url)}" via proxy ${proxy}`));
    }
    else {
        tooltip(Chalk.grey(`downloading "${Chalk.white(url)}"`));
    }

    try {
        await Download(url, dir, {
            mode: '755',
            extract: true,
            strip: 1,
            proxy
        });
    }
    catch (err) {
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
(async function () {
    let url = program.url;
    let dir = program.dir;
    if (!url || !dir) {
        console.error('Invalid parameter');
        process.exit(1);
    }

    let tmpDir = join(dir, TempDir);

    await del(tmpDir, { force: true });
    await download(url, tmpDir);

    let files = await globby('*', { cwd: tmpDir, onlyFiles: false });
    for (let i = 0; i < files.length; ++i) {
        let filename = files[i];
        await fse.move(join(tmpDir, filename), join(dir, filename), { overwrite: true });
    }

    await del(tmpDir, { force: true });
})();
