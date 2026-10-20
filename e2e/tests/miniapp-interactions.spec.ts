import { expect, test } from '@playwright/test';
import { legacyPBLSceneFixture } from '../../tests/fixtures/pbl-v1-scene';
import { upgradeLegacyPBLConfigToProjectV2 } from '../../lib/pbl/legacy/read';
import { makeSlideScene } from '../../tests/agent-runtime/_stage-fixtures';

test('mobile WebView transfers ownership and supports HTML, PBL persistence and whiteboard gestures', async ({
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await request.get('/api/stages');
  const created = await request.post('/api/stages', {
    data: { name: 'Mobile interaction test (temporary)' },
  });
  expect(created.ok()).toBeTruthy();
  const result = await created.json();
  const id = result.id ?? result.stage.id;
  const web = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'en-US',
  });
  try {
    const doc = await (await request.get(`/api/stages/${id}`)).json();
    const board = makeSlideScene('mobile-board', id, 2, 'Animated whiteboard');
    board.actions = [
      { id: 'open', type: 'wb_open' },
      {
        id: 'draw',
        type: 'wb_draw_text',
        content: 'Mobile whiteboard proof',
        x: 60,
        y: 60,
        fontSize: 30,
      },
    ];
    const projectConfig =
      legacyPBLSceneFixture.content.type === 'pbl'
        ? legacyPBLSceneFixture.content.projectConfig
        : undefined;
    if (!projectConfig) throw new Error('PBL fixture missing');
    const scenes = [
      {
        id: 'mobile-html',
        stageId: id,
        order: 0,
        title: 'Touch simulation',
        type: 'interactive',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        content: {
          type: 'interactive',
          html: '<!doctype html><html><body><input id="force" type="range" min="1" max="10" value="1" oninput="document.getElementById(\'output\').textContent=this.value*2"><output id="output">2</output></body></html>',
        },
      },
      {
        ...legacyPBLSceneFixture,
        stageId: id,
        id: 'mobile-pbl',
        order: 1,
        content: { type: 'pbl', projectV2: upgradeLegacyPBLConfigToProjectV2(projectConfig) },
      },
      board,
    ];
    expect(
      (await request.put(`/api/stages/${id}`, { data: { ...doc, scenes } })).ok(),
    ).toBeTruthy();
    // A different owner cannot mint a launch for this course.
    expect(
      (
        await web.request.post(`${baseURL}/api/miniapp/launch`, {
          data: { stageId: id, sceneId: 'mobile-html' },
        })
      ).status(),
    ).toBe(404);
    const launch = await (
      await request.post('/api/miniapp/launch', { data: { stageId: id, sceneId: 'mobile-html' } })
    ).json();
    const page = await web.newPage();
    let committed = false;
    page.on('response', (response) => {
      if (
        response.ok() &&
        response.request().method() === 'POST' &&
        response.url().includes('/records') &&
        (response.request().postData() ?? '').includes('eval-mobile-proof')
      )
        committed = true;
    });
    // Deterministic provider boundary; all course and runtime writes use the real server.
    await page.route('**/api/pbl/v2/evaluate', async (route) => {
      const body = route.request().postDataJSON();
      const evaluation = {
        id: 'eval-mobile-proof',
        kind: 'task',
        microtaskId: body.microtaskId,
        milestoneId: body.milestoneId,
        feedback: 'Mobile submission accepted',
        strengths: [],
        improvements: [],
        score: 85,
        createdAt: new Date().toISOString(),
      };
      await route.fulfill({
        contentType: 'text/event-stream',
        body: `event: project_patch\ndata: ${JSON.stringify({ type: 'project_patch', patch: { kind: 'evaluation', evaluation } })}\n\nevent: done\ndata: {"type":"done"}\n\n`,
      });
    });
    await page.route('**/api/pbl/v2/instructor', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: 'event: done\ndata: {"type":"done"}\n\n',
      }),
    );
    await page.goto(`${baseURL}${launch.path}`);
    await expect(page.locator('#mobile-scene')).toBeVisible({ timeout: 60_000 });
    const ownsCourse = await page.evaluate(async (courseId) => {
      const library = await (await fetch('/api/stages')).json();
      return library.stages.some((stage: { id: string }) => stage.id === courseId);
    }, id);
    expect(ownsCourse).toBe(true);
    await page.frameLocator('iframe').first().locator('#force').fill('7');
    await expect(page.frameLocator('iframe').first().locator('#output')).toHaveText('14');
    await page.locator('#mobile-scene').selectOption('mobile-pbl');
    await page.locator('.miniapp-pbl-tabs button').nth(0).click();
    await expect(page.locator('[data-pbl-panel=sidebar]')).toBeVisible();
    await page.locator('.miniapp-pbl-tabs button').nth(2).click();
    await page
      .locator('[data-pbl-panel=submission]')
      .getByRole('button', { name: 'Submit', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .locator('textarea')
      .fill('Prioritize dry plots and recheck moisture tomorrow.');
    await page.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(() => committed, { timeout: 30_000 }).toBe(true);
    await page.reload();
    await page.locator('.miniapp-pbl-tabs button').nth(2).click();
    await expect(page.getByText('1 submitted', { exact: true })).toBeVisible();
    await page.locator('#mobile-scene').selectOption('mobile-board');
    await page.locator('footer button').nth(1).click();
    await expect(page.getByText('Mobile whiteboard proof', { exact: false }).first()).toBeVisible();
    const viewport = page.locator('[data-whiteboard-viewport]');
    const surface = viewport.locator(':scope > div').first();
    const before = await surface.evaluate((element) => (element as HTMLElement).style.transform);
    const rect = await viewport.boundingBox();
    if (!rect) throw new Error('Whiteboard missing');
    const cdp = await web.newCDPSession(page);
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 30, y, id: 1 },
        { x: x + 30, y, id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 70, y, id: 1 },
        { x: x + 70, y, id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(() => surface.evaluate((element) => (element as HTMLElement).style.transform))
      .not.toBe(before);
  } finally {
    await web.close();
    await request.delete(`/api/stages/${id}`);
  }
});
