document.addEventListener('DOMContentLoaded', () => {
    const checkbox = document.getElementById('statusCheckbox');
    const popupStatus = document.getElementById('popupStatus');
    const settingDescription = document.getElementById('settingDescription');
    const saveState = document.getElementById('saveState');
    const views = document.querySelectorAll('[data-view]');
    let saveTimer;

    const updateInterface = (isEnabled) => {
        checkbox.checked = isEnabled;
        popupStatus.textContent = isEnabled ? 'Active' : 'Paused';
        popupStatus.classList.toggle('is-paused', !isEnabled);
        const description = isEnabled
            ? 'Hire-rate badges and job-card signals are on.'
            : 'Insights are paused until you turn them back on.';
        settingDescription.textContent = description;
    };

    const showView = (viewName) => {
        views.forEach((view) => {
            const isCurrentView = view.dataset.view === viewName;
            view.hidden = !isCurrentView;
            view.setAttribute('aria-hidden', String(!isCurrentView));
        });
    };

    chrome.storage.local.get(['isEnabled'], (result) => {
        updateInterface(result.isEnabled !== undefined ? result.isEnabled : true);
        document.body.classList.add('is-ready');
    });

    const saveStatus = (nextState) => {
        updateInterface(nextState);

        chrome.storage.local.set({ isEnabled: nextState }, () => {
            chrome.tabs.query({ url: '*://*/*' }, (tabs) => {
                tabs.forEach((tab) => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'toggleStatus',
                        status: nextState
                    }).catch(() => {});
                });
            });

            window.clearTimeout(saveTimer);
            saveState.classList.add('is-visible');
            saveTimer = window.setTimeout(() => {
                saveState.classList.remove('is-visible');
            }, 1800);
        });
    };

    checkbox.addEventListener('change', () => saveStatus(checkbox.checked));

    document.querySelectorAll('[data-view-link]').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            showView(link.dataset.viewLink);
        });
    });

    document.querySelectorAll('[data-back]').forEach((button) => {
        button.addEventListener('click', () => showView('main'));
    });
});
