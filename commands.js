import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

const TRIGGER_CHECKIN_COMMAND = {
  name: 'trigger-checkin',
  description: 'Manually send the current check-in message',
  type: 1,
};

const ALL_COMMANDS = [TRIGGER_CHECKIN_COMMAND];
InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
