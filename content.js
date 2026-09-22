const HOVER_DELAY_MS = 500;
const DETAIL_REQUEST_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 2000;
const LOG_PREFIX = '[Upwork Accelerator]';
const JOB_CARD_SELECTOR = 'article.job-tile, .up-card-section, [data-test="job-tile"]';

// One state per Job ID (or URL fallback) avoids duplicate requests and races.
const jobStates = new Map();
const cardStates = new WeakMap();
let isExtensionActive = true;

chrome.storage.local.get(['isEnabled'], (result) => {
    if (result.isEnabled !== undefined) isExtensionActive = result.isEnabled;
    renderStatusIndicator();
});

function log(message) {
    console.info(LOG_PREFIX + ' ' + message);
}

function logJob(jobId, message) {
    log('Job ID: ' + (jobId || 'not detected') + ' — ' + message);
}

function logUnavailable(reason) {
    console.info(LOG_PREFIX + ' Hire Rate unavailable — reason: ' + reason);
}

function renderStatusIndicator() {
    let indicator = document.getElementById('accelerator-screen-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'accelerator-screen-indicator';
        document.body.appendChild(indicator);
    }
    if (isExtensionActive) {
        indicator.innerHTML = '<span class="pulse-dot"></span> Accelerator Active';
        indicator.className = 'screen-indicator-bar active-indicator';
    } else {
        indicator.innerHTML = '<span class="off-dot"></span> Accelerator Paused';
        indicator.className = 'screen-indicator-bar inactive-indicator';
    }
}

function removeBadgeEffects() {
    document.querySelectorAll('.accelerator-hire-badge, .accelerator-hire-loading, .accelerator-hire-unavailable').forEach(el => el.remove());
    document.querySelectorAll('.accelerator-status-green').forEach(el => el.classList.remove('accelerator-status-green'));
    document.querySelectorAll('.accelerator-status-red').forEach(el => {
        el.classList.remove('accelerator-status-red');
        el.style.opacity = '1';
    });
    document.querySelectorAll('.accelerator-status-neutral').forEach(el => el.classList.remove('accelerator-status-neutral'));
}

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'toggleStatus') {
        isExtensionActive = request.status;
        renderStatusIndicator();
        if (!isExtensionActive) removeBadgeEffects();
    }
});

function getCardState(card) {
    let state = cardStates.get(card);
    if (!state) {
        state = { hoverTimer: null, runId: 0, cacheKey: null };
        cardStates.set(card, state);
    }
    return state;
}

function initializeJobCard(card) {
    const context = getJobContext(card);
    const cardState = getCardState(card);
    if (card.dataset.acceleratorInitialized === 'true' && cardState.cacheKey === context.cacheKey) return;

    if (card.dataset.acceleratorInitialized === 'true') {
        // Upwork can recycle a rendered card for another job while scrolling.
        // Invalidate only this card's old result; Job-ID cache entries remain intact.
        if (cardState.hoverTimer) clearTimeout(cardState.hoverTimer);
        cardState.hoverTimer = null;
        cardState.runId += 1;
        card.querySelectorAll('.accelerator-hire-badge, .accelerator-hire-loading, .accelerator-hire-unavailable').forEach(el => el.remove());
        card.classList.remove('accelerator-status-green', 'accelerator-status-red', 'accelerator-status-neutral');
        card.style.opacity = '1';
        delete card.dataset.processed;
        delete card.dataset.loading;
        logJob(context.jobId, 'card reused for a new Job ID; previous card state cleared');
    }

    card.dataset.acceleratorInitialized = 'true';
    cardState.cacheKey = context.cacheKey;
    logJob(context.jobId, 'card detected' + (context.url ? '' : '; job link is not available yet'));
}

function initializeJobCards(root = document) {
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(JOB_CARD_SELECTOR)) initializeJobCard(root);
    root.querySelectorAll?.(JOB_CARD_SELECTOR).forEach(initializeJobCard);
}

function observeJobCards() {
    initializeJobCards();
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    initializeJobCards(node);
                    const parentCard = node.closest?.(JOB_CARD_SELECTOR);
                    if (parentCard) initializeJobCard(parentCard);
                }
            }
            if (record.type === 'attributes' && record.target instanceof Element) {
                const parentCard = record.target.closest(JOB_CARD_SELECTOR);
                if (parentCard) initializeJobCard(parentCard);
            }
        }
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'data-job-id', 'data-job-uid', 'data-ev-job-uid', 'data-job-posting-id']
    });
    log('SPA observer started; new job cards will be initialized once');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeJobCards, { once: true });
} else {
    observeJobCards();
}

document.addEventListener('mouseover', (event) => {
    if (!isExtensionActive || !(event.target instanceof Element)) return;
    const jobCard = event.target.closest(JOB_CARD_SELECTOR);
    if (!jobCard || jobCard.dataset.processed === 'true') return;
    if (event.relatedTarget instanceof Node && jobCard.contains(event.relatedTarget)) return;
    initializeJobCard(jobCard);
    scheduleHireRateLookup(jobCard);
});

document.addEventListener('mouseout', (event) => {
    if (!(event.target instanceof Element)) return;
    const jobCard = event.target.closest(JOB_CARD_SELECTOR);
    if (!jobCard || (event.relatedTarget instanceof Node && jobCard.contains(event.relatedTarget))) return;
    const cardState = cardStates.get(jobCard);
    if (cardState?.hoverTimer) {
        clearTimeout(cardState.hoverTimer);
        cardState.hoverTimer = null;
        logJob(getJobContext(jobCard).jobId, 'hover ended before the 0.5-second display threshold');
    }
});

function scheduleHireRateLookup(card) {
    const cardState = getCardState(card);
    if (cardState.hoverTimer) clearTimeout(cardState.hoverTimer);
    const context = getJobContext(card);
    const runId = ++cardState.runId;
    const lookup = getHireRateForCard(card, context);
    logJob(context.jobId, 'hover lookup scheduled');

    cardState.hoverTimer = setTimeout(() => {
        cardState.hoverTimer = null;
        if (!isExtensionActive || card.dataset.processed === 'true' || cardState.runId !== runId) return;
        card.dataset.loading = 'true';
        showLoadingState(card);
        logJob(context.jobId, 'display threshold reached; request state is pending');
        lookup
            .then(result => settleCardLookup(card, context, runId, result))
            .catch(error => settleCardLookup(card, context, runId, {
                status: 'deferred',
                reason: 'unexpected extraction error: ' + (error instanceof Error ? error.message : String(error))
            }));
    }, HOVER_DELAY_MS);
}

function settleCardLookup(card, context, runId, result) {
    const cardState = cardStates.get(card);
    if (!cardState || cardState.runId !== runId || !document.contains(card)) return;
    if (!isExtensionActive) return;

    if (result.status === 'resolved') {
        removeLoadingState(card);
        card.dataset.loading = 'false';
        logJob(context.jobId, 'final extraction result: ' + result.rate + '% from ' + result.source);
        log('Hire Rate: ' + result.rate + '%');
        injectAcceleratorMetrics(card, result.rate);
        card.dataset.processed = 'true';
    } else if (result.status === 'unavailable') {
        removeLoadingState(card);
        card.dataset.loading = 'false';
        logJob(context.jobId, 'final extraction result: unavailable (' + result.reason + ')');
        logUnavailable(result.reason);
        injectUnavailableState(card);
        card.dataset.processed = 'true';
    } else if (result.backgroundPromise) {
        // Five seconds is a UI deadline, not a failed extraction. Keep Checking…
        // while the permitted same-origin document request completes in the background.
        logJob(context.jobId, 'request is still pending after timeout; keeping Checking… visible');
        result.backgroundPromise.then(finalResult => {
            const latestCardState = cardStates.get(card);
            if (latestCardState?.runId === runId && document.contains(card)) {
                settleCardLookup(card, context, runId, finalResult);
            }
        });
    } else {
        // A timeout/delay is not evidence that no Hire Rate exists.
        removeLoadingState(card);
        card.dataset.loading = 'false';
        logJob(context.jobId, 'final extraction deferred: ' + result.reason + '; card remains retryable');
    }
}

async function getHireRateForCard(card, context) {
    logJob(context.jobId, 'Data source being checked: job-card DOM');
    const cardRate = getHireRateFromText(card.innerText || card.textContent || '');
    if (cardRate !== null) {
        logJob(context.jobId, 'request state: resolved from card DOM');
        return { status: 'resolved', rate: cardRate, source: 'job-card DOM' };
    }
    if (!context.url) {
        return { status: 'deferred', reason: 'job-detail link is not available on this dynamically loading card' };
    }
    return getJobDetailResult(context);
}

function getJobDetailResult(context) {
    const existing = jobStates.get(context.cacheKey);
    if (existing?.status === 'resolved' || existing?.status === 'unavailable') {
        logJob(context.jobId, 'cache hit; request state: ' + existing.status);
        return Promise.resolve(existing.result);
    }
    if (existing?.status === 'pending') {
        logJob(context.jobId, 'cache hit; request state: shared pending request');
        return existing.promise;
    }
    if (existing?.retryAfter && Date.now() < existing.retryAfter) {
        const remaining = Math.ceil(existing.retryAfter - Date.now());
        logJob(context.jobId, 'request state: retry delayed for ' + remaining + ' ms');
        return Promise.resolve({
            status: 'deferred',
            reason: 'previous request is temporarily delayed; retry available in ' + remaining + ' ms'
        });
    }

    logJob(context.jobId, 'cache miss; request state: starting same-origin job-detail request');
    const state = { status: 'pending', promise: null, backgroundPromise: null };
    const backgroundPromise = getHireRateFromJobDetail(context.url, context.jobId);
    const promise = waitForJobResult(backgroundPromise, context.jobId)
        .then(result => {
            if (result.status === 'deferred' && result.backgroundPromise) {
                logJob(context.jobId, 'request state: still pending after UI timeout');
            }
            return result;
        })
        .catch(error => ({
            status: 'deferred',
            reason: 'job-detail request failed: ' + (error instanceof Error ? error.message : String(error))
        }));

    state.promise = promise;
    state.backgroundPromise = backgroundPromise;
    jobStates.set(context.cacheKey, state);

    backgroundPromise
        .then(result => {
            if (result.status === 'resolved' || result.status === 'unavailable') {
                state.status = result.status;
                state.result = result;
                logJob(context.jobId, 'request state: ' + result.status + ' and cached');
            } else {
                state.status = 'deferred';
                state.retryAfter = Date.now() + RETRY_DELAY_MS;
                logJob(context.jobId, 'request state: ' + result.status + '; retryable');
            }
        })
        .catch(error => {
            state.status = 'deferred';
            state.retryAfter = Date.now() + RETRY_DELAY_MS;
            logJob(context.jobId, 'request state: failed; retryable');
        });
    return promise;
}

function waitForJobResult(backgroundPromise, jobId) {
    let timeoutId;
    const timeoutResult = new Promise(resolve => {
        timeoutId = setTimeout(() => {
            logJob(jobId, 'request timeout after ' + DETAIL_REQUEST_TIMEOUT_MS + ' ms; continuing in background');
            resolve({
                status: 'deferred',
                reason: 'job-detail document is still loading after ' + DETAIL_REQUEST_TIMEOUT_MS + ' ms',
                backgroundPromise
            });
        }, DETAIL_REQUEST_TIMEOUT_MS);
    });

    return Promise.race([backgroundPromise, timeoutResult]).then(result => {
        if (!result.backgroundPromise) clearTimeout(timeoutId);
        return result;
    });
}

function getJobContext(card) {
    const jobLink = card.querySelector(
        'h2.job-tile-title a, a.job-title-link, [data-test="job-tile-title"] a, a[href*="/jobs/"]'
    );
    if (!jobLink) return { jobId: null, url: null, cacheKey: null };
    try {
        const url = new URL(jobLink.href, location.href);
        if (url.origin !== location.origin || !url.pathname.includes('/jobs/')) return { jobId: null, url: null, cacheKey: null };
        const jobId = extractJobId(card, jobLink, url);
        return { jobId, url, cacheKey: jobId || url.href };
    } catch {
        return { jobId: null, url: null, cacheKey: null };
    }
}

function extractJobId(card, jobLink, url) {
    const idAttribute = ['data-job-id', 'data-job-uid', 'data-ev-job-uid', 'data-job-posting-id']
        .map(name => card.getAttribute(name) || jobLink.getAttribute(name) || card.querySelector('[' + name + ']')?.getAttribute(name))
        .find(Boolean);
    if (idAttribute) return idAttribute;
    const urlMatch = url.href.match(/~[a-zA-Z0-9]+|(?:jobId|job_id)=([^&#/]+)/i);
    return urlMatch ? decodeURIComponent(urlMatch[1] || urlMatch[0]) : null;
}

async function getHireRateFromJobDetail(url, jobId) {
    try {
        // Ordinary job URL in the user's existing session: no private API or bypass.
        const response = await fetch(url.href, { credentials: 'same-origin' });
        if (!response.ok) return { status: 'deferred', reason: 'job-detail document returned temporary HTTP ' + response.status };
        const finalUrl = new URL(response.url, location.href);
        if (finalUrl.origin !== location.origin || !finalUrl.pathname.includes('/jobs/')) {
            return { status: 'deferred', reason: 'job-detail document redirected before client information was available' };
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
            return { status: 'deferred', reason: 'job-detail document returned ' + (contentType || 'an unknown content type') + ', not HTML' };
        }
        const detailDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
        return getHireRateFromDetailDocument(detailDocument, jobId);
    } catch (error) {
        return {
            status: 'deferred',
            reason: 'job-detail document request failed: ' + (error instanceof Error ? error.message : String(error))
        };
    }
}

function getHireRateFromDetailDocument(detailDocument, jobId) {
    logJob(jobId, 'Data source being checked: job-detail About the client markup');
    for (const section of getClientSections(detailDocument)) {
        const rate = getHireRateFromText(section.innerText || section.textContent || '');
        if (rate !== null) return { status: 'resolved', rate, source: 'job-detail About the client markup' };
    }
    logJob(jobId, 'Data source being checked: job-detail embedded state');
    for (const script of detailDocument.querySelectorAll('script')) {
        const rate = getHireRateFromEmbeddedState(script.textContent || '');
        if (rate !== null) return { status: 'resolved', rate, source: 'job-detail embedded state' };
    }
    return {
        status: 'unavailable',
        reason: 'no labelled hire rate was present in the job card, job-detail client markup, or job-detail embedded state'
    };
}

function getClientSections(detailDocument) {
    const sections = new Set();
    detailDocument.querySelectorAll('[data-test*="client" i], [class*="client" i], [id*="client" i]').forEach(element => sections.add(element));
    for (const heading of detailDocument.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
        if (/^about\s+the\s+client$/i.test((heading.textContent || '').trim())) {
            sections.add(heading.closest('section, aside, div') || heading.parentElement);
        }
    }
    return [...sections].filter(Boolean);
}

function getHireRateFromText(text) {
    const match = text.match(/(?:hire\s*rate\s*:?\s*)(\d{1,3})\s*%|(\d{1,3})\s*%\s*hire\s*rate/i);
    const rate = match ? Number(match[1] || match[2]) : null;
    return Number.isInteger(rate) && rate >= 0 && rate <= 100 ? rate : null;
}

function getHireRateFromJson(jsonText) {
    try {
        return findHireRateInObject(JSON.parse(jsonText));
    } catch {
        return null;
    }
}

function getHireRateFromEmbeddedState(scriptText) {
    const jsonRate = getHireRateFromJson(scriptText);
    if (jsonRate !== null) return jsonRate;
    if (scriptText.length > 1000000) return null;
    const match = scriptText.match(/["'](?:client[_-]?hire[_-]?rate|hire[_-]?rate)["']\s*:\s*["']?(\d{1,3}(?:\.\d+)?)\s*%?["']?/i);
    return match ? getRateFromValue(Number(match[1])) : null;
}

function findHireRateInObject(value, seen = new WeakSet(), visited = { count: 0 }) {
    if (!value || typeof value !== 'object' || seen.has(value) || visited.count++ > 10000) return null;
    seen.add(value);
    for (const [key, nestedValue] of Object.entries(value)) {
        if (/^client.?hire.?rate$|^hire.?rate$/i.test(key)) {
            const rate = getRateFromValue(nestedValue);
            if (rate !== null) return rate;
        }
        const nestedRate = findHireRateInObject(nestedValue, seen, visited);
        if (nestedRate !== null) return nestedRate;
    }
    return null;
}

function getRateFromValue(value) {
    if (typeof value === 'string') return getHireRateFromText('Hire Rate: ' + value);
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rate = Number.isInteger(value) ? value : value * 100;
    return Number.isInteger(rate) && rate >= 0 && rate <= 100 ? rate : null;
}

function injectAcceleratorMetrics(card, rate) {
    if (card.querySelector('.accelerator-hire-badge')) return;
    const badge = document.createElement('div');
    badge.className = 'accelerator-hire-badge';
    badge.innerText = 'Hire rate ' + rate + '%';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-label', 'Client hire rate: ' + rate + '%');
    if (rate >= 80) {
        card.classList.add('accelerator-status-green');
        badge.classList.add('badge-green');
        badge.dataset.tooltip = 'Strong client hiring history — worth a closer look.';
    } else if (rate < 50) {
        card.classList.add('accelerator-status-red');
        badge.classList.add('badge-red');
        badge.dataset.tooltip = 'Lower client hiring history — review the brief carefully.';
    } else {
        card.classList.add('accelerator-status-neutral');
        badge.classList.add('badge-neutral');
        badge.dataset.tooltip = 'Moderate client hiring history.';
    }
    getMetricsContainer(card).appendChild(badge);
}

function getMetricsContainer(card) {
    return card.querySelector('.job-tile-info, .client-activity, [data-test="client-metrics"]') || card;
}

function showLoadingState(card) {
    if (card.querySelector('.accelerator-hire-loading')) return;
    const loading = document.createElement('div');
    loading.className = 'accelerator-hire-loading';
    loading.innerText = 'Checking hire rate';
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', 'Checking client hire rate');
    getMetricsContainer(card).appendChild(loading);
}

function removeLoadingState(card) {
    card.querySelectorAll('.accelerator-hire-loading').forEach(el => el.remove());
}

function injectUnavailableState(card) {
    if (card.querySelector('.accelerator-hire-badge, .accelerator-hire-unavailable')) return;
    const unavailable = document.createElement('div');
    unavailable.className = 'accelerator-hire-unavailable';
    unavailable.innerText = 'Hire rate unavailable';
    unavailable.dataset.tooltip = 'Upwork did not provide a client hire rate for this job.';
    unavailable.setAttribute('role', 'status');
    unavailable.setAttribute('aria-label', 'Client hire rate unavailable');
    getMetricsContainer(card).appendChild(unavailable);
}
