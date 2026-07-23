import assert from 'node:assert/strict';
import { buildLoginField, buildManualCredentialEmbed } from '../utils/ctf-credentials';

const login = buildLoginField('team`name', 'pa||ss');
assert.equal(login.name, 'Login');
assert.match(login.value, /teamˋname/);
assert.match(login.value, /pa∣∣ss/);
assert.doesNotMatch(login.value, /pa\|\|ss/);

const pending = buildLoginField();
assert.match(pending.value, /ct-regacc/);

const embed = buildManualCredentialEmbed(
  {
    ctftimeid: 0,
    role: '1',
    cate: '2',
    name: 'HTB Test',
    infom: '0',
    channel: '3',
    endtime: 300,
    archived: false,
    channelsPurged: false,
    postEndOpened: false,
    starttime: 100,
    competitionEndtime: 200,
  },
  'bksec',
  'secret'
);
assert.equal(embed.title, 'HTB Test — Shared Account');
assert.equal(embed.fields[0].name, 'Login');
assert.match(embed.fields[1].value, /<t:100:F>/);
assert.equal(embed.fields[2].value, 'Manual / non-CTFtime event');

console.log('ctf credentials tests passed');
