# Workflows

Workflows for creator team.

## Prerequisite

### Install Node.js

- Mac:

	Install [nvm](https://github.com/creationix/nvm).<br>
	Install [Node.js®](https://nodejs.org/) via nvm:
	```bash
	nvm install node
	```
	And then in any new shell just use the installed version:
	```bash
	nvm use node
	```

- Windows:

	Install [Node.js®](https://nodejs.org/).

### Install modules

```bash
cd path/to/repo
npm install
```

### Settings

Open `package.json` and check "workflows_settings" for default settings.
If you need, place your settings in `settings.js` to overwrite the default settings. See `settings.js.sample` for details.

## Commands

**Tag Version**

以下命令将会根据 fireball 下的 package.json 中的 version，自动给所有依赖的 repo（含 cocos2d-x-lite）打上 tag，并且推送到 cocos-creator 远端仓库。

```bash
npm run tag
```

以下命令将会根据指定路径下的 package.json 中的 version 来打 tag，并且推送到 cocos-creator 远端仓库。如果是 fireball 仓库，还会自动更新依赖的 repo（不含 cocos2d-x-lite）。

```bash
npm run tag -- --path path/to/repo
```

**Deploy Product**

该命令会将文件上传到 FTP

```bash
npm run upload -- path/to/file --dest TestBuilds/xxx.zip --user Admin --password 123456 --host 127.0.0.1
```

如果希望在上传前先从 FTP 移除和目标文件版本号相同，只是补丁版本不同的相同文件，可以在最后加上一个参数 --archieve-same-version

```bash
npm run upload -- ....  --archieve-same-version
```

这样一来相关文件就会被移动到 ../Histroy 目录中。

**Download**

该命令会将文件下载到指定位置，并且解压

```bash
npm run download -- --url https://github.com/cocos-creator/hello-world/archive/v1.10.zip --dir ./test
```

### GitHub Commands

以下命令全程操作都通过 GitHub API 远程进行，不会影响到本地 git 仓库。所有操作会批量在 fireball 主仓库、2d-x 仓库和 22 个子仓库中进行。

**New Branch**

该命令会在所有仓库中创建新分支

```bash
npm run new-branch -- -b oldBranch,newBranch
```

步骤如下

 - 遍历所有仓库
   - 创建新分支
 - 更新 package.json 中的依赖分支并且提交到主仓库的新分支上

**List PR**

```bash
npm run list-pr -- branch1 [...branch2]
```

该命令会显示所有 GitHub 上需要合并的 PR，可以输入任意多个分支，最后一个分支将用于解析依赖的仓库。结果将在浏览器中显示。

```bash
npm run list-pr -- -s semver
```

该命令接受一个 semver 作为分支名，如 2.x。

**Clean Issue**

```bash
npm run clean-issue
```

该命令会列出所有可以关闭的 Issue，结果将在浏览器中打开。判断规则如下：
 - 如果有未合并的 PR 关联到 issue 上，则不可关闭
 - 如果有提交或者已合并的 PR 关联到 issue 上，则可关闭

**Sync Branch**

```bash
npm run sync-branch
```

该命令会自动同步所有 GitHub 上的所有开发分支（按版本顺序依次合并改动），需要同步的仓库将从 fireball 最新若干个分支中的 package.json 收集而来。

**Delete Branch**

```bash
npm run delete-branch -- -b branch [--df] [--du]
```

该命令会删除 GitHub 仓库上的指定分支，需要同步的仓库将从 fireball 最新若干个分支中的 package.json 收集而来。
 - '--df' 命令用于强制删除功能分支
 - '--du' 命令用于强制删除未合并的分支

分支删除后，将会打上 tag 用于标记位置。如果该分支有未合并的 PR，删除分支后将会自动还原 PR，并且进行相应回复。

**Changelog**

```bash
npm run changelog -- branch (fromTime|fromVersion) [-t (toTime|toVersion)]
npm run changelog -- branch (fromTime|fromVersion) [-r [recordVersion]]
```

该命令会以 PR 为单位收集改动列表，结果将在浏览器中打开。
 - 'branch' 表示版本发布所用分支，所有更早的版本分支上的 PR 也会一同收集。不对分支是否已合并进行检查。
 - 'fromTime' 参数指定起始时间，如 `2019-04-01T00:00:00`。
 - 'fromVersion' 参数指定起始版本，将通过版本号（如 2.0.0-alpha.1）来获取指定版本的时间。
 - 'toTime' 参数指定结束时间，如果省略则使用当前时间。
 - 'toVersion' 参数指定结束版本号，如果省略则使用当前时间。
 - 'recordVersion' 参数指定需要保存的版本号，会将当前时间记录到指定版本号，以便后续用于 fromVersion 或 toVersion。当参数省略，将根据 fromVersion 自动 + 1。

```bash
npm run changelog -- -r recordVersion
```

该命令不会收集改动列表，仅用于记录版本号对应的时间
