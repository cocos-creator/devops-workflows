
process.on('unhandledRejection', (reason) => {
    const chalk = require('chalk');
    console.error(chalk.red(reason.stack || reason));
});
