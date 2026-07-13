import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

// Permission bit for "Manage Server" — Discord's permission bitfield value
const MANAGE_GUILD = '32';

const TRIGGER_CHECKIN_COMMAND = {
  name: 'trigger-checkin',
  description: 'Manually send the current check-in message',
  type: 1,
  default_member_permissions: MANAGE_GUILD,
};

const SET_CHECKIN_CHANNEL_COMMAND = {
  name: 'set-checkin-channel',
  description: 'Set the channel where check-in messages are sent',
  type: 1,
  default_member_permissions: MANAGE_GUILD,
  options: [
    {
      type: 7, // CHANNEL
      name: 'channel',
      description: 'The channel for check-in messages',
      required: true,
    },
  ],
};

const SET_SUMMARY_CHANNEL_COMMAND = {
  name: 'set-summary-channel',
  description: 'Set the channel where the :55 summary is sent',
  type: 1,
  default_member_permissions: MANAGE_GUILD,
  options: [
    {
      type: 7, // CHANNEL
      name: 'channel',
      description: 'The channel for the missed check-in summary',
      required: true,
    },
  ],
};

const SET_SHEET_COMMAND = {
  name: 'set-sheet',
  description: 'Set the Google Sheet ID used for check-in data',
  type: 1,
  default_member_permissions: MANAGE_GUILD,
  options: [
    {
      type: 3, // STRING
      name: 'sheet_id',
      description: 'The Google Sheet ID (from the sheet URL)',
      required: true,
    },
  ],
};

const SYNC_ROLE_COMMAND = {
  name: 'sync-role',
  description: 'Add a role to everyone listed in a Sheet column',
  type: 1,
  default_member_permissions: MANAGE_GUILD,
  options: [
    {
      type: 8, // ROLE
      name: 'role',
      description: 'Role to assign',
      required: true,
    },
    {
      type: 3, // STRING
      name: 'column',
      description: 'Sheet column letter containing Discord IDs (e.g. C)',
      required: true,
    },
    {
      type: 3, // STRING
      name: 'sheet_tab',
      description: 'Sheet tab name (defaults to G1)',
      required: false,
    },
  ],
};

const ALL_COMMANDS = [
  TRIGGER_CHECKIN_COMMAND,
  SET_CHECKIN_CHANNEL_COMMAND,
  SET_SUMMARY_CHANNEL_COMMAND,
  SET_SHEET_COMMAND,
  SYNC_ROLE_COMMAND,
];
InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);