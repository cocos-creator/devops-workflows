
const { DataToMarkdownBase } = require('./utils');

const title = 'Cocos Creator Pull Requests';

class DataToMarkdown extends DataToMarkdownBase {

    _renderChunk (chunk) {
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
        return this._renderRepo(data);
    }

    _renderHeader (info) {
        return `
# ${title}

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
}

module.exports = {
    DataToMarkdown,
};
