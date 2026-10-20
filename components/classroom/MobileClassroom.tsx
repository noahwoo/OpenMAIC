'use client';
import { useEffect, useRef, useState } from 'react';
import { useStageStore } from '@/lib/store';
import { flushStageSave } from '@/lib/store/stage';
import { useCanvasStore } from '@/lib/store/canvas';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import { SceneProvider } from '@/lib/contexts/scene-context';
import { SceneRenderer } from '@/components/stage/scene-renderer';
import { InteractiveIframeHost } from '@/components/scene-renderers/InteractiveIframeHost';
import { Whiteboard } from '@/components/whiteboard';
import { ActionEngine } from '@/lib/action/engine';
import { PlaybackEngine, type EngineMode } from '@/lib/playback';
import { createAudioPlayer } from '@/lib/utils/audio-player';
import { useI18n } from '@/lib/hooks/use-i18n';

/** Mobile chrome around the SAME scene, PBL, iframe and whiteboard runtimes. */
export function MobileClassroom() {
  const sceneId = useStageStore((s) => s.currentSceneId);
  return <MobileScene key={sceneId} />;
}
function MobileScene() {
  const { t } = useI18n();
  const scenes = useStageStore((s) => s.scenes);
  const sceneId = useStageStore((s) => s.currentSceneId);
  const scene = scenes.find((s) => s.id === sceneId);
  const whiteboardOpen = useCanvasStore((s) => s.whiteboardOpen);
  const player = useRef<PlaybackEngine | null>(null);
  const [mode, setMode] = useState<EngineMode>('idle');
  const [speech, setSpeech] = useState('');
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    document.body.classList.add('miniapp-mode');
    useStageStore.getState().setMode('playback');
    return () => {
      document.body.classList.remove('miniapp-mode');
    };
  }, []);
  useEffect(() => {
    const current = useStageStore.getState().scenes.find((s) => s.id === sceneId);
    if (!current) return;
    const audio = createAudioPlayer();
    const actions = new ActionEngine(useStageStore, audio, (type, payload) => {
      useWidgetIframeStore.getState().getSendMessage(current.id)?.(type, payload);
    });
    const engine = new PlaybackEngine([current], actions, audio, {
      onModeChange: setMode,
      onSpeechStart: setSpeech,
      // Mobile lecture playback skips optional group discussions; PBL chat keeps its own complete runtime.
      isAgentSelected: () => false,
    });
    player.current = engine;
    const pause = () => {
      if (document.hidden) leave();
    };
    const leave = () => {
      engine.pause();
      void flushStageSave().catch((error) => console.warn('[miniapp] save pending', error));
    };
    document.addEventListener('visibilitychange', pause);
    window.addEventListener('pagehide', leave);
    return () => {
      player.current = null;
      engine.stop();
      actions.dispose();
      audio.destroy();
      document.removeEventListener('visibilitychange', pause);
      window.removeEventListener('pagehide', leave);
    };
  }, [sceneId]);
  if (!scene) return <p role="status">{t('common.loadingClassroom')}</p>;
  const index = scenes.findIndex((s) => s.id === scene.id);
  function select(id: string) {
    player.current?.pause();
    useStageStore.getState().setCurrentSceneId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('scene', id);
    window.history.replaceState(null, '', url);
  }
  function play() {
    const engine = player.current;
    if (!engine) return;
    if (engine.getMode() === 'playing') engine.pause();
    else if (engine.getMode() === 'paused') engine.resume();
    else engine.start();
  }
  return (
    <main className="miniapp-classroom">
      <header>
        <h1>{scene.title}</h1>
        <label className="sr-only" htmlFor="mobile-scene">
          {t('miniapp.chapter')}
        </label>
        <select id="mobile-scene" value={scene.id} onChange={(e) => select(e.target.value)}>
          {scenes.map((s, i) => (
            <option key={s.id} value={s.id}>
              {i + 1}. {s.title}
            </option>
          ))}
        </select>
      </header>
      {scene.type === 'interactive' && (
        <label className="miniapp-zoom">
          {t('miniapp.zoom')}{' '}
          <input
            aria-label={t('miniapp.zoom')}
            type="range"
            min="1"
            max="2.5"
            step="0.25"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <output>{Math.round(zoom * 100)}%</output>
        </label>
      )}
      <section className={`miniapp-canvas ${scene.type}`}>
        <div
          className="miniapp-scene"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        >
          <SceneProvider>
            <SceneRenderer scene={scene} mode="playback" mobile />
          </SceneProvider>
        </div>
        <div className="miniapp-board">
          <SceneProvider>
            <Whiteboard
              isOpen={whiteboardOpen}
              onClose={() => useCanvasStore.getState().setWhiteboardOpen(false)}
            />
          </SceneProvider>
        </div>
      </section>
      <InteractiveIframeHost />
      {speech && (
        <p className="miniapp-caption" aria-live="polite">
          {speech}
        </p>
      )}
      <footer>
        <button disabled={index === 0} onClick={() => select(scenes[index - 1].id)}>
          {t('miniapp.previous')}
        </button>
        {scene.type !== 'pbl' && (
          <button onClick={play}>{t(mode === 'playing' ? 'miniapp.pause' : 'miniapp.play')}</button>
        )}
        <button
          onClick={() => useCanvasStore.getState().setWhiteboardOpenManually(!whiteboardOpen)}
        >
          {t('miniapp.whiteboard')}
        </button>
        <button disabled={index + 1 === scenes.length} onClick={() => select(scenes[index + 1].id)}>
          {t('miniapp.next')}
        </button>
      </footer>
    </main>
  );
}
