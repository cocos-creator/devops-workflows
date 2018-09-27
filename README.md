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
