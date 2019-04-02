
const PORT = 3401;

let pendingResponse = null;
let pendingContent = null;

function checkResponse () {
    if (pendingContent && pendingResponse) {

        pendingContent.pipe(pendingResponse);
        // pendingContent.end();

        pendingResponse = null;
        pendingContent = null;
    }
}

module.exports = {
    launch () {
        const { createServer } = require('http');
        const server = createServer();

        server.on('request', async (req, res) => {
            // console.log(req.url);
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.on('finish', () => {
                    server.unref();
                    server.close();
                    process.exit(0);
                });
                // res.write('Loading...');

                pendingResponse = res;
                checkResponse();
            }
            else {
                res.end();
            }
        });
        server.listen(PORT);
    },
    send (content) {
        pendingContent = content;
        checkResponse();
    },
    openBrowser () {
        let url = 'http://localhost:' + PORT;
        let start = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start': 'xdg-open');
        require('child_process').exec(start + ' ' + url);
    }
};
