import {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
  ChatInputCommandInteraction,
  Interaction,
} from 'discord.js';
import { config } from './config/env';
import logger from './utils/logger';
import { handleReady, stopReadyServices } from './events/ready';
import { handleButtonInteraction } from './components/buttons';
import { handleChallengeMessage } from './events/message-create';
import { Command } from './types';
import databaseService from './services/database.service';

// Import all commands
import ctInfoFind from './commands/ctftime/info-find';
import ctInfoOngo from './commands/ctftime/info-ongo';
import ctInfoUpco from './commands/ctftime/info-upco';
import ctReg from './commands/ctftime/reg';
import ctRegacc from './commands/ctftime/regacc';
import cList from './commands/general/list';
import cView from './commands/general/view';
import cWhoami from './commands/general/whoami';
import cHelp from './commands/general/help';
// Non-CTF integrations are temporarily disabled while the core CTF workflow is tested.
// import cVerify from './commands/general/verify';
// import cInviteRepoWuGcsb from './commands/general/invite-repo-wu-gcsb';
import cSolve from './commands/general/solve';
import cChallenge from './commands/general/challenge';
import cWriteup from './commands/general/writeup';
import adminHide from './commands/admin/hide';
import adminRegSpecial from './commands/admin/reg-special';
import adminDelete from './commands/admin/delete';
import adminAdd from './commands/admin/add';
import adminDenyRole from './commands/admin/deny-role';
import adminVerifyG10 from './commands/admin/verifyg10';
import adminFix from './commands/admin/fix';
import adminUnsolve from './commands/admin/unsolve';
import adminSetTime from './commands/admin/set-time';
// TODO: RE-ENABLE TASK COMMANDS — disabled because required env vars
// (ADMIN_ROLE_ID, TASK_ADMIN_CHANNEL_ID, TASK_ROLE_*) are not set.
// To turn back on:
//   1. Set the task env vars in .env
//   2. Uncomment the imports below
//   3. Uncomment the entries in the `commands` array below
//   4. Uncomment the select-menu / modal handlers in interactionCreate
//   5. Restore the required-vars list in src/config/env.ts
// import taskIssue from './commands/tasks/issue-task';
// import taskSubmit from './commands/tasks/submit';
// import taskStatus from './commands/tasks/task-status';
// import taskShowAll from './commands/tasks/show-all';
// import { handleTaskModalInteraction, handleTaskSelectInteraction } from './components/task-interactions';

/**
 * Extended Client class with commands collection
 */
class BotClient extends Client {
  public commands: Collection<string, Command>;

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.commands = new Collection();
  }
}

const client = new BotClient();
let shuttingDown = false;

// Register all commands
const commands: Command[] = [
  ctInfoFind,
  ctInfoOngo,
  ctInfoUpco,
  ctReg,
  ctRegacc,
  cList,
  cView,
  cWhoami,
  cHelp,
  // cVerify,
  // cInviteRepoWuGcsb,
  cSolve,
  cChallenge,
  cWriteup,
  adminHide,
  adminRegSpecial,
  adminDelete,
  adminAdd,
  adminDenyRole,
  adminFix,
  adminUnsolve,
  adminSetTime,
  ...(config.VERIFY_REMOVE_ROLE_ID && config.VERIFY_GRANT_ROLE_ID && config.VERIFY_ALLOWED_ROLE_ID
    ? [adminVerifyG10]
    : []),
  // TODO: RE-ENABLE TASK COMMANDS (see top of file)
  // taskIssue,
  // taskSubmit,
  // taskStatus,
  // taskShowAll,
];

for (const command of commands) {
  client.commands.set(command.data.name, command);
}

/**
 * Register slash commands with Discord
 */
async function deployCommands() {
  try {
    logger.info('Started refreshing application (/) commands.');

    const rest = new REST({ version: '10' }).setToken(config.BOT_TOKEN);

    const commandData = commands.map((cmd) => cmd.data.toJSON());
    const applicationId = client.application?.id ?? client.user?.id;
    if (!applicationId) throw new Error('Discord application ID is unavailable');

    await rest.put(Routes.applicationGuildCommands(applicationId, config.SERVER_ID), {
      body: commandData,
    });

    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error('Error deploying commands:', error);
  }
}

/**
 * Handle ready event
 */
client.once('clientReady', () => {
  void (async () => {
    await handleReady(client);
    await deployCommands();
  })().catch((error) => {
    logger.error('Bot initialization failed:', error);
    void shutdown('initialization failure', 1);
  });
});

/**
 * Handle interaction create event
 */
async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) {
        await interaction.respond([]);
        return;
      }
      await command.autocomplete(interaction);
    } else if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        logger.warn(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      await command.execute(interaction as ChatInputCommandInteraction);
    } else if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      // TODO: RE-ENABLE TASK COMMANDS — uncomment these handlers (see top of file)
      // } else if (interaction.isStringSelectMenu()) {
      //   await handleTaskSelectInteraction(interaction);
      // } else if (interaction.isModalSubmit()) {
      //   await handleTaskModalInteraction(interaction);
    }
  } catch (error) {
    logger.error('Error handling interaction:', error);

    if (interaction.isRepliable()) {
      const errorMessage = {
        content: 'There was an error executing this command!',
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage).catch((replyError) => {
          logger.warn('Could not send interaction error follow-up:', replyError);
        });
      } else {
        await interaction.reply(errorMessage).catch((replyError) => {
          logger.warn('Could not send interaction error response:', replyError);
        });
      }
    }
  }
}

client.on('interactionCreate', (interaction) => {
  void handleInteraction(interaction).catch((error) => {
    logger.error('Interaction boundary failed:', error);
  });
});

client.on('messageCreate', (message) => {
  void handleChallengeMessage(message).catch((error) => {
    logger.error('Message boundary failed:', error);
  });
});

client.on('error', (error) => logger.error('Discord client error:', error));
client.on('warn', (warning) => logger.warn(`Discord client warning: ${warning}`));
client.on('shardError', (error, shardId) => logger.error(`Discord shard ${shardId} error:`, error));
client.on('invalidated', () => {
  logger.error('Discord session invalidated; requesting a clean restart.');
  void shutdown('Discord session invalidated', 1);
});

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  if (exitCode === 0) {
    logger.info(`Shutting down: ${reason}`);
  } else {
    logger.error(`Shutting down after fatal error: ${reason}`);
  }

  stopReadyServices();
  try {
    client.destroy();
  } catch (error) {
    logger.warn('Could not destroy Discord client cleanly:', error);
  }
  try {
    databaseService.close();
  } catch (error) {
    logger.warn('Could not close SQLite cleanly:', error);
  }

  // Give Winston transports a short window to flush before terminating.
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.exit(exitCode);
}

/**
 * Handle process errors
 */
process.once('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection:', error);
  void shutdown('unhandled promise rejection', 1);
});

process.once('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  void shutdown('uncaught exception', 1);
});

process.once('SIGINT', () => void shutdown('SIGINT', 0));
process.once('SIGTERM', () => void shutdown('SIGTERM', 0));

/**
 * Start the bot
 */
async function start() {
  await client.login(config.BOT_TOKEN);
  logger.info('Bot login successful');
}

void start().catch((error) => {
  logger.error('Failed to login:', error);
  void shutdown('login failure', 1);
});
