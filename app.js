import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  MessageComponentTypes,
  ButtonStyleTypes,
} from 'discord-interactions';
import { VerifyDiscordRequest, DiscordRequest } from './utils.js';
import { getAllRows, getColumnValues } from './sheets.js';
import { loadState, saveState } from './state.js';
import { getGuildConfig, setGuildConfig, loadConfig } from './config.js';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ verify: VerifyDiscordRequest(process.env.PUBLIC_KEY) }));

function extractUserIds(text) {
  const matches = [...text.matchAll(/<@!?(\d+)>/g)];
  return [...new Set(matches.map(m => m[1]))];
}

function getUpcomingHourTimestamp() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return Math.floor(now.getTime() / 1000);
}

function renderMessageContent(pending) {
  const statusLines = pending.userIds.map(id => {
    const checked = pending.confirmed.includes(id);
    return `${checked ? '✅' : '❌'} <@${id}>`;
  });
  return `${pending.text}\n\n**Check-in status:**\n${statusLines.join('\n')}`;
}

async function sendReminder(text, pingId, channelId) {
  await DiscordRequest(`channels/${channelId}/messages`, {
    method: 'POST',
    body: {
      content: text,
      components: [
        {
          type: MessageComponentTypes.ACTION_ROW,
          components: [
            {
              type: MessageComponentTypes.BUTTON,
              custom_id: `confirm_${pingId}`,
              label: 'Confirm',
              style: ButtonStyleTypes.PRIMARY,
            },
          ],
        },
      ],
    },
  });
}

async function addRoleToMember(guildId, userId, roleId) {
  return fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
    }
  );
}

async function runCheckInForGuild(guildId, triggeredManually = false) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.channelId || !cfg.sheetId) {
    console.log(`[checkin] Guild ${guildId} missing config, skipping.`);
    return { sent: false, reason: 'not_configured' };
  }

  console.log(`[checkin] Running${triggeredManually ? ' (manual trigger)' : ''} for guild ${guildId} at`, new Date().toISOString());
  const rows = await getAllRows('G1', cfg.sheetId);
  const targetTs = getUpcomingHourTimestamp();
  const row = rows.find(r => parseInt(r.timestamp, 10) === targetTs);

  if (!row || !row.text) {
    console.log('[checkin] No matching row found, skipping.');
    return { sent: false, reason: 'no_row' };
  }

  const text = row.text;
  const userIds = extractUserIds(text);
  const pingId = Date.now().toString();

  const pending = { pingId, timestamp: targetTs, text, userIds, confirmed: [] };
  await sendReminder(renderMessageContent(pending), pingId, cfg.channelId);

  const state = loadState();
  state[guildId] = { pending };
  saveState(state);

  console.log('[checkin] Sent message for row:', row.timestamp);
  return { sent: true };
}

// :45 — run for every configured guild
cron.schedule('45 * * * *', async () => {
  const config = loadConfig();
  for (const guildId of Object.keys(config)) {
    try {
      await runCheckInForGuild(guildId);
    } catch (err) {
      console.error(`Error sending :45 message for guild ${guildId}:`, err);
    }
  }
});

// :55 — per guild, post summary if needed, always clear pending after
cron.schedule('55 * * * *', async () => {
  const config = loadConfig();
  for (const guildId of Object.keys(config)) {
    try {
      const cfg = config[guildId];
      if (!cfg.summaryChannelId) continue;

      const state = loadState();
      const guildState = state[guildId];
      const pending = guildState?.pending;
      if (!pending) continue;

      const missing = pending.userIds.filter(id => !pending.confirmed.includes(id));

      if (missing.length > 0) {
        const mentions = missing.map(id => `<@${id}>`).join(' ');
        const summaryText = `${missing.length} user(s) did not check in: ${mentions}\nConsider sending an emergency ping.`;
        await DiscordRequest(`channels/${cfg.summaryChannelId}/messages`, {
          method: 'POST',
          body: { content: summaryText },
        });
      }

      // Always clear pending after :55 runs, regardless of outcome —
      // prevents stale pending from leaking into the next hour if :45 finds no row.
      state[guildId] = { pending: null };
      saveState(state);
    } catch (err) {
      console.error(`Error posting :55 summary for guild ${guildId}:`, err);
    }
  }
});

app.post('/interactions', async function (req, res) {
  const { type, data, guild_id } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = data;

    if (name === 'set-checkin-channel') {
      const channelId = options[0].value;
      setGuildConfig(guild_id, { channelId });
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `Check-in channel set to <#${channelId}>.`},
      });
    }

    if (name === 'set-summary-channel') {
      const summaryChannelId = options[0].value;
      setGuildConfig(guild_id, { summaryChannelId });
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `Summary channel set to <#${summaryChannelId}>.`},
      });
    }

    if (name === 'set-sheet') {
      const sheetId = options[0].value;
      setGuildConfig(guild_id, { sheetId });
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `Sheet ID updated.`},
      });
    }

    if (name === 'trigger-checkin') {
      res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: InteractionResponseFlags.EPHEMERAL },
      });

      try {
        const result = await runCheckInForGuild(guild_id, true);
        let content = 'Check-in triggered.';
        if (!result.sent) {
          content = result.reason === 'not_configured'
            ? 'This server isn\'t configured yet. Use /set-checkin-channel and /set-sheet first.'
            : 'No matching row found for the current time slot.';
        }
        await DiscordRequest(`webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
          method: 'PATCH',
          body: { content },
        });
      } catch (err) {
        console.error('Error running manual check-in:', err);
        await DiscordRequest(`webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
          method: 'PATCH',
          body: { content: 'Something went wrong triggering the check-in.' },
        });
      }
      return;
    }

    if (name === 'sync-role') {
      res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: InteractionResponseFlags.EPHEMERAL },
      });

      const roleId = options.find(o => o.name === 'role').value;
      const column = options.find(o => o.name === 'column').value.toUpperCase();
      const sheetTabOpt = options.find(o => o.name === 'sheet_tab');
      const sheetTab = sheetTabOpt ? sheetTabOpt.value : 'G1';

      try {
        const cfg = getGuildConfig(guild_id);
        if (!cfg.sheetId) {
          await DiscordRequest(`webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
            method: 'PATCH',
            body: { content: "This server isn't configured yet. Use /set-sheet first." },
          });
          return;
        }

        const userIds = await getColumnValues(sheetTab, cfg.sheetId, column);
        const results = { added: [], notInGuild: [], failed: [] };

        for (const userId of userIds) {
          let response;
          try {
            response = await addRoleToMember(guild_id, userId, roleId);
          } catch (err) {
            results.failed.push(userId);
            continue;
          }

          if (response.status === 204) {
            results.added.push(userId);
          } else if (response.status === 404) {
            results.notInGuild.push(userId);
          } else if (response.status === 429) {
            const body = await response.json().catch(() => ({}));
            await new Promise(r => setTimeout(r, (body.retry_after || 1) * 1000));
            const retry = await addRoleToMember(guild_id, userId, roleId);
            retry.status === 204 ? results.added.push(userId) : results.failed.push(userId);
          } else {
            results.failed.push(userId);
          }

          // Gentle pacing to avoid tripping the per-route rate limit.
          await new Promise(r => setTimeout(r, 300));
        }

        const summary =
          `**Role sync complete for <@&${roleId}>**\n` +
          `✅ Added: ${results.added.length}\n` +
          `⚠️ Not in server: ${results.notInGuild.length}\n` +
          `❌ Failed: ${results.failed.length}` +
          (results.notInGuild.length
            ? `\nNot in server: ${results.notInGuild.map(id => `<@${id}>`).join(', ')}`
            : '') +
          (results.failed.length
            ? `\nFailed: ${results.failed.map(id => `<@${id}>`).join(', ')}`
            : '');

        await DiscordRequest(`webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
          method: 'PATCH',
          body: { content: summary },
        });
      } catch (err) {
        console.error('Error running sync-role:', err);
        await DiscordRequest(`webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
          method: 'PATCH',
          body: { content: 'Something went wrong syncing the role.' },
        });
      }
      return;
    }
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    const componentId = data.custom_id;

    if (componentId.startsWith('confirm_')) {
      const pingId = componentId.replace('confirm_', '');
      const state = loadState();
      const guildState = state[guild_id];
      const clickingUserId = req.body.member.user.id;

      if (!guildState?.pending || guildState.pending.pingId !== pingId) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'This has expired.', flags: InteractionResponseFlags.EPHEMERAL },
        });
      }

      if (!guildState.pending.userIds.includes(clickingUserId)) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: "You aren't on the check-in, silly!", flags: InteractionResponseFlags.EPHEMERAL },
        });
      }

      if (!guildState.pending.confirmed.includes(clickingUserId)) {
        guildState.pending.confirmed.push(clickingUserId);
        state[guild_id] = guildState;
        saveState(state);
      }

      return res.send({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: renderMessageContent(guildState.pending),
          components: [
            {
              type: MessageComponentTypes.ACTION_ROW,
              components: [
                {
                  type: MessageComponentTypes.BUTTON,
                  custom_id: `confirm_${pingId}`,
                  label: 'Confirm',
                  style: ButtonStyleTypes.PRIMARY,
                },
              ],
            },
          ],
        },
      });
    }
  }

  res.status(400).send('Unhandled interaction type');
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});