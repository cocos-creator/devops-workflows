const Fs = require('fs-extra');
const Path = require('path');
const spawn = require('child_process').spawn;

function getUnzip (bin) {
    return function (src, dist) {
        var path = Path.dirname(dist);
        Fs.ensureDirSync(path);

        var child = spawn(bin, [
            '-q',   // quiet mode
            '-o',   // overwrite files WITHOUT prompting
            src,
            '-d', dist
        ], {
            stdio: 'inherit'
        });
        return new Promise((resolve, reject) => {
            child.on('close', (code) => {
                // code == 0 测试通过，其余的为文件有问题
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new Error('The decompression has failed'));
                }
            });
        });
    };
}

if (process.platform === 'darwin') {
    module.exports = getUnzip('unzip');
}
else if (process.platform === 'win32') {
    module.exports = getUnzip('editor\\static\\tools\\unzip.exe');
}
else {
    module.exports = function (src, dist) {
        const Decompress = require('decompress');
        return Decompress(src, dist);
    };
}
