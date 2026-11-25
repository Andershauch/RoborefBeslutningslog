import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchRoborefOverview, roborefLinks} from '../src/client/roboref-overview.ts';

test('overview shows the latest Roboref title, editor and history timestamp independently of the imported version', async () => {
  const data = {
    prompts: [{id: 'p', title: 'Gammelt navn'}],
    versions: [{id: 'v', prompt_id: 'p', number: 1}],
    events: [
      {
        version_id: 'v',
        action: 'uploaded',
        detail: JSON.stringify({
          source: {system: 'Roboref', id: 7, title: 'Gammelt navn', validFrom: '2026-01-01'},
        }),
      },
    ],
  };
  const links = roborefLinks(data);
  assert.equal(links[0].id, 7);
  const info = await fetchRoborefOverview(links, async (body) =>
    body.action === 'list'
      ? [{id: 7, title: 'Nyt navn'}]
      : [{validFrom: '2026-03-01T10:00:00Z', editedBy: {name: 'En kollega'}}],
  );
  assert.deepEqual(info.p, {
    title: 'Nyt navn',
    editor: 'En kollega',
    validFrom: '2026-03-01T10:00:00Z',
  });
});
test('unavailable history and missing editor never invent a name or date', async () => {
  const links = [
    {promptId: 'a', id: 1, title: 'A'},
    {promptId: 'b', id: 2, title: 'B'},
  ];
  const info = await fetchRoborefOverview(links, async (body) => {
    if (body.action === 'list')
      return [
        {id: 1, title: 'A'},
        {id: 2, title: 'B'},
      ];
    if (body.id === 1) throw Error('offline');
    return [{validFrom: '2026-01-01T00:00:00Z', editedBy: null}];
  });
  assert.equal(info.a.editor, null);
  assert.equal(info.a.validFrom, null);
  assert.ok(info.a.error);
  assert.equal(info.b.editor, null);
});
