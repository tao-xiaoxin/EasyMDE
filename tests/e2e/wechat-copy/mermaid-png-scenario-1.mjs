// Complete mermaid png scenario owner.
import { expect } from '@playwright/test';
import { assertMermaidFingerprintSensitivity } from "./mermaid-geometry.mjs";
import { canonicalMermaidRoles } from "./markdown-fixtures.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { readGanttLayoutProbe } from "./mermaid-geometry.mjs";
import { readMermaidSourceFingerprints } from "./mermaid-geometry.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";

export async function runMermaidPngScenario1({ baseURL, login, page, test, testInfo }) {

    test.setTimeout(8 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await installEditorBootstrapOverride(page, true);
    const imageRoute = fullCapabilityImageSource;
    let imageRouteHits = 0;
    await page.route(imageRoute, async (route) => {
      imageRouteHits += 1;
      await route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 });
    });
    const fullMarkdown = fullCapabilityMarkdown;
    const otherMermaidSemanticBaseline = [];
    let layoutBaseline = null;
    let sequenceGeometryBaseline = null;
    const probes = [];
    try {
      for (const [index, width] of [255, 335, 677].entries()) {
        await page.setViewportSize({ height: 900, width });
        await openEasyMdeNewPost(page);
        await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
        let preview = page.locator(
          '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
        );
        if (2 === index) {
          const immersiveLabels = await page.evaluate(
            () => window.EasyMDEEditorRootBootstrap.strings.immersive
          );
          await page.locator('.easymde-toolbar-immersive-toggle').click();
          await expect(page.getByRole('region', {
            name: immersiveLabels.immersive
          })).toBeVisible();
          await page.getByRole('button', {
            name: immersiveLabels.splitMode,
            exact: true
          }).click();
          preview = page.locator(
            '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
          );
          await expect(preview).toBeVisible();
          await waitForPreviewVisualReadiness(page);
        }
        const fingerprints = await readMermaidSourceFingerprints(preview);
        expect(fingerprints).toHaveLength(10);
        expect(fingerprints.map(({ role }) => role)).toEqual(canonicalMermaidRoles);
        for (const role of ['gantt', 'sequence', 'timeline']) {
          expect(fingerprints.filter((entry) => entry.role === role), `${role} role uniqueness`)
            .toHaveLength(1);
        }
        const gantt = fingerprints.find(({ role }) => role === 'gantt');
        if (!gantt) throw new Error('wechat-gantt-fingerprint-unavailable');
        expect(gantt.viewBox.width).toBe(1200);
        const sequence = fingerprints.find(({ role }) => role === 'sequence');
        if (!sequence) throw new Error('wechat-sequence-fingerprint-unavailable');
        const sequenceGeometry = (({ counts, font, labels, markers, paint, viewBox }) => ({
          counts,
          font,
          labels,
          markers,
          paint,
          viewBox
        }))(sequence);
        const otherMermaidSemantics = fingerprints
          .filter(({ role }) => !['sequence', 'gantt', 'timeline'].includes(role))
          .map(({ counts, font, labels, markers, ordinal, paint, role }) => {
            const paintStyle = paint
              .map(({
                fill,
                markerEnd,
                markerStart,
                opacity,
                stroke,
                strokeWidth,
                tag,
                vectorEffect
              }) => ({
                fill,
                markerEnd,
                markerStart,
                opacity,
                stroke,
                strokeWidth,
                tag,
                vectorEffect
              }))
              .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
            return {
              counts,
              font,
              labels,
              markers,
              ordinal,
              paintStyle,
              role
            };
          });
        if (0 === index) {
          sequenceGeometryBaseline = sequenceGeometry;
          otherMermaidSemanticBaseline.push(...otherMermaidSemantics);
          await assertMermaidFingerprintSensitivity(preview);
        } else {
          expect(sequenceGeometry).toEqual(sequenceGeometryBaseline);
          expect(otherMermaidSemantics).toEqual(otherMermaidSemanticBaseline);
        }
        const probe = await readGanttLayoutProbe(preview);
        expect(probe.layout).toBe('gantt');
        expect(probe.viewBox.width).toBe(1200);
        expect(probe.viewBox.height).toBeGreaterThan(0);
        expect(probe.svg.width).toBeCloseTo(probe.viewBox.width, 0);
        expect(probe.svg.height).toBeCloseTo(probe.viewBox.height, 0);
        expect(probe.svg.ctm).toEqual(expect.objectContaining({
          a: 1,
          b: 0,
          c: 0,
          d: 1
        }));
        expect(probe.dates.length).toBeGreaterThan(0);
        expect(probe.tasks.length).toBeGreaterThan(0);
        expect(probe.milestones.length).toBeGreaterThan(0);
        expect(probe.dateIntersections).toBe(0);
        expect(probe.owner.scrollRange).toBeGreaterThan(0);
        if (!layoutBaseline) {
          layoutBaseline = {
            dates: probe.dates,
            milestones: probe.milestones,
            tasks: probe.tasks
          };
        } else {
          expect(probe.dates).toEqual(layoutBaseline.dates);
          expect(probe.milestones).toEqual(layoutBaseline.milestones);
          expect(probe.tasks).toEqual(layoutBaseline.tasks);
        }
        probes.push({
          dateIntersections: probe.dateIntersections,
          ganttViewBox: probe.viewBox,
          mode: 2 === index ? 'immersive' : 'ordinary',
          owner: probe.owner,
          viewportWidth: width
        });
      }
    } finally {
      await page.unroute(imageRoute);
    }
    expect(probes).toHaveLength(3);
    expect(imageRouteHits).toBeGreaterThan(0);
}
