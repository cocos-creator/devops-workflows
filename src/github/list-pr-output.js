
const { Transform } = require('stream');
const { readFileSync } = require('fs-extra');
let showdown = null;
const ghCssPath = require.resolve('github-markdown-css');

const title = 'Cocos Creator Pull Requests';


class DataToMarkdown extends Transform {
    constructor (info) {
        super({
            writableObjectMode: true,
        });

        this.push(this._renderHeader(info));
    }
    _transform (chunk, encoding, callback) {
        // console.log(chunk);
        let { repo, prs } = chunk;
        prs.forEach(x => {
            x.updatedAt = new Date(x.updatedAt).toLocaleString('zh-cn');
        });
        let data = {
            name: repo.repo,
            url: repo.url,
            prs
        };
        let text = this._renderRepo(data);
        this.push(text);
        callback();
    }
    _final (callback) {
        let text = this._renderFooter();
        this.push(text);
        callback();
    }

    _renderHeader (info) {
        return `
<h1 align="center">
${title}
</h1>

\`\`\`
${info}
\`\`\`
`;
    }

    _renderRepo (data) {
        function list (array, callback) {
            return array.map(callback).join('\n');
        }

        return `
## [${data.name}](${data.url})

${list(data.prs, pr => `
### [${pr.title}](${pr.url})

> branch: **${pr.baseRefName}**, author: **${pr.author.login}**, updated: **${pr.updatedAt}**

<blockquote>
${pr.bodyHTML}
</blockquote>
`)}
`;
    }

    _renderFooter () {
        return `
----
<div align="center">
Made wtih ❤️ by Jare
</div>
`;
    }
}

class MarkdownToHTML extends Transform {
    constructor () {
        super();

        showdown = require('showdown');
        this.converter = new showdown.Converter({
            openLinksInNewWindow: true,
        });
        this.converter.setFlavor('github');

        let css = readFileSync(ghCssPath, 'utf8');
        this.push(this._renderHeader(title, css));
    }
    _transform (chunk, encoding, callback) {
        let html = this._renderMarkdown(chunk.toString());
        this.push(html);
        callback();
    }
    _final (callback) {
        this.push(this._renderFooter());
        callback();
    }

    _renderMarkdown (text) {
        let content = this.converter.makeHtml(text);
        return content;
    }

    _renderHeader (title, css) {

        return `
<!DOCTYPE HTML>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
	.markdown-body {
		box-sizing: border-box;
		min-width: 200px;
		max-width: 980px;
		margin: 0 auto;
		padding: 45px;
	}

	@media (max-width: 767px) {
		.markdown-body {
			padding: 15px;
		}
	}
	
${css}
</style>
</head>
<body class="markdown-body">`;

    }

    _renderFooter () {
        return `
</body>
</html>
`;
    }
}

module.exports = {
    DataToMarkdown,
    MarkdownToHTML,
};
