// main.js
const { SheetsProcessor } = require('./first_process'); // Adjust path as needed

async function main() {
    const processor = new SheetsProcessor();

    process.on('unhandledRejection', async (reason, promise) => {
        await processor.logger.error('Unhandled Rejection', { reason: reason?.message });
        process.exit(1);
    });

    process.on('uncaughtException', async (error) => {
        await processor.logger.error('Uncaught Exception', { error: error.message });
        process.exit(1);
    });

    try {
        await processor.run();
        process.exit(0);
    } catch (error) {
        console.error('Application failed:', error.message);
        process.exit(1);
    }
}

main();
