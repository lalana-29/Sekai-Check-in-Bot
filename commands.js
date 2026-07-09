import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

const ALL_COMMANDS = [];
InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);