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
import { getAllRows } from './sheets.js';
import { loadState, saveState } from './state.js';

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

async function sendReminder(text, pingId) {
  await DiscordRequest(`channels/${process.env.CHANNEL_ID}/messages`, {
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

async function runCheckIn(triggeredManually = false) {
  console.log(`[checkin] Running${triggeredManually ? ' (manual trigger)' : ''} at`, new Date().toISOString());
  const rows = await getAllRows('G1');
  const targetTs = getUpcomingHourTimestamp();
  console.log('[checkin] Target timestamp:', targetTs);
  const row = rows.find(r => parseInt(r.timestamp, 10) === targetTs);

  if (!row || !row.text) {
    console.log('[checkin] No matching row found, skipping.');
    return false;
  }

  const text = row.text;
  const userIds = extractUserIds(text);
  const pingId = Date.now().toString();
  await sendReminder(text, pingId);

  saveState({ pending: { pingId, timestamp: targetTs, text, userIds, confirmed: [] } });
  console.log('[checkin] Sent message for row:', row.timestamp);
  return true;
}

// :45 — find and send the row matching the upcoming :00
cron.schedule('45 * * * *', async () => {
  try {
    await runCheckIn();
  } catch (err) {
    console.error('Error sending :45 message:', err);
  }
});

// :55 — post a summary of who hasn't confirmed, in a different channel
cron.schedule('55 * * * *', async () => {
  try {
    const state = loadState();
    const { pending } = state;
    if (!pending) return;

    const missing = pending.userIds.filter(id => !pending.confirmed.includes(id));

    if (missing.length === 0) {
      saveState({ pending: null });
      return;
    }

    const mentions = missing.map(id => `<@${id}>`).join(' ');
    const summaryText = `${missing.length} user(s) did not check in: ${mentions}\nConsider sending an emergency ping.`;

    await DiscordRequest(`channels/${process.env.SUMMARY_CHANNEL_ID}/messages`, {
      method: 'POST',
      body: { content: summaryText },
    });
  } catch (err) {
    console.error('Error posting :55 summary:', err);
  }
});

app.post('/interactions', async function (req, res) {
  const { type, data } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === 'trigger-checkin') {
      res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: InteractionResponseFlags.EPHEMERAL },
      });

      try {
        const found = await runCheckIn(true);
        await DiscordRequest(`webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
          method: 'PATCH',
          body: {
            content: found ? 'Check-in triggered.' : 'No matching row found for the current time slot.',
          },
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
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    const componentId = data.custom_id;

    if (componentId.startsWith('confirm_')) {
      const pingId = componentId.replace('confirm_', '');
      const state = loadState();
      const clickingUserId = req.body.member.user.id;

      if (!state.pending || state.pending.pingId !== pingId) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'This has expired.', flags: InteractionResponseFlags.EPHEMERAL },
        });
      }

      if (!state.pending.userIds.includes(clickingUserId)) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: "This isn't for you.", flags: InteractionResponseFlags.EPHEMERAL },
        });
      }

      if (!state.pending.confirmed.includes(clickingUserId)) {
        state.pending.confirmed.push(clickingUserId);
        saveState(state);
      }

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `<@${clickingUserId}> confirmed ✅`, flags: InteractionResponseFlags.EPHEMERAL },
      });
    }
  }

  res.status(400).send('Unhandled interaction type');
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
