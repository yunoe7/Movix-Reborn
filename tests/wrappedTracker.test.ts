import assert from 'node:assert/strict';
import test from 'node:test';
import { createWrappedTracker } from '../src/utils/wrappedTrackerCore.ts';

// Horloge à la main et envois enregistrés : [cible, secondes].
function setup({ enabled = true, failing = false } = {}) {
    const state = { now: 1_000_000, enabled, failing };
    const sent: [string, number][] = [];
    const tracker = createWrappedTracker<string>({
        now: () => state.now,
        collectionEnabled: () => state.enabled,
        send: async (target, seconds) => {
            if (state.failing) return false;
            sent.push([target, seconds]);
            return true;
        },
    });
    const wait = (seconds: number) => { state.now += seconds * 1000; };
    return { state, sent, tracker, wait };
}

test('lecture continue : 30 s envoyées toutes les 30 s', async () => {
    const { tracker, sent, wait } = setup();
    tracker.setActive(true);
    tracker.setTarget('film');
    for (let i = 0; i < 3; i += 1) {
        wait(30);
        await tracker.tick();
    }
    assert.deepEqual(sent, [['film', 30], ['film', 30], ['film', 30]]);
});

test('collecte coupée : rien ne part, ni à l’onglet masqué, ni au changement, ni au démontage', async () => {
    const { tracker, sent, wait } = setup({ enabled: false });
    tracker.setActive(true);
    tracker.setTarget('film');
    wait(20);
    tracker.setVisible(false);
    tracker.setVisible(true);
    wait(20);
    tracker.setTarget('autre film');
    wait(20);
    await tracker.tick();
    tracker.setTarget(null);
    await Promise.resolve();
    assert.deepEqual(sent, []);
    assert.equal(tracker.pendingSeconds(), 0);
});

test('collecte coupée en cours de route : le temps déjà cumulé est jeté', async () => {
    const { tracker, sent, wait, state } = setup();
    tracker.setActive(true);
    tracker.setTarget('film');
    wait(20);
    state.enabled = false;
    tracker.setTarget(null);
    await Promise.resolve();
    assert.deepEqual(sent, []);
});

test('suivi inactif ou onglet masqué : ce temps ne compte pas', async () => {
    const { tracker, sent, wait } = setup();
    tracker.setActive(true);
    tracker.setTarget('film');
    wait(10);
    tracker.setActive(false);
    wait(40);
    tracker.setActive(true);
    wait(10);
    tracker.setVisible(false);
    await Promise.resolve();
    wait(50);
    tracker.setVisible(true);
    wait(4);
    tracker.setTarget(null);
    await Promise.resolve();
    // 10 s + 10 s envoyées à l'onglet masqué, puis les 4 s restantes.
    assert.deepEqual(sent, [['film', 20], ['film', 4]]);
});

test('fermeture d’une chaîne (inactif puis plus de cible) : la fin est envoyée', async () => {
    const { tracker, sent, wait } = setup();
    tracker.setActive(true);
    tracker.setTarget('chaîne');
    wait(12);
    tracker.setActive(false);
    tracker.setTarget(null);
    await Promise.resolve();
    assert.deepEqual(sent, [['chaîne', 12]]);
});

test('changement de contenu : le reste part à l’ancien, pas au nouveau', async () => {
    const { tracker, sent, wait } = setup();
    tracker.setActive(true);
    tracker.setTarget('épisode 1');
    wait(25);
    tracker.setTarget('épisode 2');
    wait(30);
    await tracker.tick();
    assert.deepEqual(sent, [['épisode 1', 25], ['épisode 2', 30]]);
});

test('envoi raté : le temps est gardé et renvoyé, dans la limite de 60 s', async () => {
    const { tracker, sent, wait, state } = setup({ failing: true });
    tracker.setActive(true);
    tracker.setTarget('film');
    wait(30);
    assert.equal(await tracker.tick(), true);
    assert.deepEqual(sent, []);
    assert.equal(tracker.pendingSeconds(), 30);

    // Nouvel essai 4 s plus tard : tout le temps part d'un coup.
    state.failing = false;
    wait(4);
    assert.equal(await tracker.tick(), false);
    assert.deepEqual(sent, [['film', 34]]);

    state.failing = true;
    for (let i = 0; i < 4; i += 1) {
        wait(30);
        await tracker.tick();
    }
    assert.equal(tracker.pendingSeconds(), 60);
});

test('changement de cible avec envoi raté : le temps est gardé pour la cible d’origine', async () => {
    const { tracker, sent, wait, state } = setup({ failing: true });
    tracker.setActive(true);
    tracker.setTarget('film');
    wait(25);
    tracker.setTarget('autre film');
    await Promise.resolve();
    await Promise.resolve();

    state.failing = false;
    wait(10);
    assert.equal(await tracker.tick(), false);
    assert.deepEqual(sent, [['film', 25], ['autre film', 10]]);

    wait(30);
    assert.equal(await tracker.tick(), false);
    assert.deepEqual(sent, [['film', 25], ['autre film', 10], ['autre film', 30]]);
});

test('plusieurs changements de cible en échec gardent chaque cible', async () => {
    const { tracker, sent, wait, state } = setup({ failing: true });
    tracker.setActive(true);
    tracker.setTarget('a');
    wait(10);
    tracker.setTarget('b');
    wait(12);
    tracker.setTarget('c');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    state.failing = false;
    wait(5);
    assert.equal(await tracker.tick(), false);
    assert.deepEqual(sent, [['a', 10], ['b', 12], ['c', 5]]);
});

test('échec pendant un changement de cible : l’envoi en vol n’est pas perdu', async () => {
    const state = { now: 1_000_000 };
    const sent: [string, number][] = [];
    let release: (() => void) | null = null;
    let calls = 0;
    const tracker = createWrappedTracker<string>({
        now: () => state.now,
        collectionEnabled: () => true,
        send: async (target, seconds) => {
            calls += 1;
            if (calls === 1) {
                await new Promise<void>((resolve) => { release = resolve; });
                return false;
            }
            sent.push([target, seconds]);
            return true;
        },
    });

    tracker.setActive(true);
    tracker.setTarget('film');
    state.now += 30_000;
    const ticking = tracker.tick();
    for (let i = 0; i < 10 && !release; i += 1) await Promise.resolve();
    assert.ok(release, 'le premier envoi doit être en vol');
    tracker.setTarget('autre film');
    release();
    assert.equal(await ticking, true);

    state.now += 10_000;
    assert.equal(await tracker.tick(), false);
    assert.deepEqual(sent, [['film', 30], ['autre film', 10]]);
});

test('trou de plus d’une minute (appareil endormi) : rien n’est compté', async () => {
    const { tracker, sent, wait } = setup();
    tracker.setActive(true);
    tracker.setTarget('film');
    wait(600);
    await tracker.tick();
    assert.deepEqual(sent, []);
    wait(30);
    await tracker.tick();
    assert.deepEqual(sent, [['film', 30]]);
});

test('moins de 5 s : pas d’envoi périodique, mais envoyé au départ dès 1 s', async () => {
    const { tracker, sent, wait } = setup();
    tracker.setActive(true);
    tracker.setTarget('page');
    wait(3);
    await tracker.tick();
    assert.deepEqual(sent, []);
    tracker.setTarget(null);
    await Promise.resolve();
    assert.deepEqual(sent, [['page', 3]]);
});
