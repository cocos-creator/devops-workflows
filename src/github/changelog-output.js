
const { Transform } = require('stream');
const { DataToMarkdownBase, initBranch, sortBranches } = require('./utils');

const title = 'Cocos Creator Changelog';

const REPO_PRIORITY = ['engine', 'fireball'];      // 值越大显示在越前面

class Sort extends Transform {
    constructor () {
        super({
            writableObjectMode: true,
            readableObjectMode: true,
        });

        this._branchToChunks = Object.create(null);
    }
    _transform (chunk, encoding, callback) {
        let branch = chunk.which.branch;
        if (this._branchToChunks[branch]) {
            this._branchToChunks[branch].push(chunk);
        }
        else {
            this._branchToChunks[branch] = [chunk];
        }
        callback();
    }
    _final (callback) {
        let branches = Object.keys(this._branchToChunks).map(x => ({ name: x }));
        branches.forEach(initBranch);
        sortBranches(branches);
        branches.reverse();
        for (let branch of branches) {
            let chunks = this._branchToChunks[branch.name];
            chunks.sort((lhs, rhs) => {
                lhs = lhs.which.repo;
                rhs = rhs.which.repo;
                let lhsIndex = REPO_PRIORITY.indexOf(lhs);
                let rhsIndex = REPO_PRIORITY.indexOf(rhs);
                if (lhsIndex !== rhsIndex) {
                    return rhsIndex - lhsIndex;
                }
                else {
                    return lhs.localeCompare(rhs);
                }
            });
            for (let chunk of chunks) {
                this.push(chunk);
            }
        }
        callback();
    }
}

class DataToMarkdown extends DataToMarkdownBase {
    constructor (info) {
        super(info);

        this._lastBranch = null;
    }

    _renderChunk (chunk) {
        // console.log(chunk);
        let { which, pr } = chunk;
        pr.mergedAt = new Date(pr.mergedAt).toLocaleString('zh-cn');

        function list (array, callback) {
            return array.map(callback).join('\n');
        }

        function when (test, text) {
            return test ? text : '';
        }

        let text = '';
        let branch = pr.baseRefName;
        if (this._lastBranch !== branch) {
            text += `## ${branch}\n`;
            this._lastBranch = branch;
        }
        let repo = which.repo;
        let link = '';
        if (!pr.repository.isPrivate) {
            link = `, Link: [#${pr.number}] ${pr.url}`
        }
        text += `[${repo}] [${pr.title}](${pr.url})
<blockquote>
Author: ${pr.author.login}${link}<br>
${pr.bodyText}
</blockquote>
`;
        return text;
    }

    _renderHeader (info) {
        return `
# ${title}

\`\`\`
${info}
\`\`\`
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

module.exports = {
    Sort,
    DataToMarkdown,
};
