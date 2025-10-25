import { MediaWikiApi } from 'https://unpkg.com/wiki-saikou?module';

const MAX_FILES = 10;
const TARGET_WIKI_PASTE_URL = 'https://xyy.miraheze.org/wiki/Special:Test/B';
const DEFAULT_EMPTY_WIKITEXT = '== Summary ==\n{{fi|s=}}\n== Licensing ==\n{{fairuse}}';

let currentLang = 'en';
let settings = { lang: 'en', apiEndpoint: '', authKey: '' };
let sourceWiki = null;
let fetchedFilesData = [];
let totalFetchedSize = 0;
let fileNsCanonical = 'File';
let fileNsLocalized = '';
let isInitialLoad = true;

const pageTitleElement = document.querySelector('title');
const settingsButton = document.getElementById('settings-button');
const themeToggle = document.getElementById('theme-toggle');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsButton = document.getElementById('close-settings-button');
const languageSelect = document.getElementById('setting-language');
const apiEndpointInput = document.getElementById('setting-api-endpoint');
const authKeyInput = document.getElementById('setting-authkey');
const authKeyWarning = document.getElementById('authkey-warning');
const saveSettingsButton = document.getElementById('save-settings-button');
const settingsMessage = document.getElementById('settings-message');
const apiStatusDiv = document.getElementById('api-status');

const filenamesFetchTextarea = document.getElementById('filenames-fetch');
const fetchButton = document.getElementById('fetch-button');
const fetchMessage = document.getElementById('fetch-message');
const fileSizeInfo = document.getElementById('file-size-info');

const editorCard = document.getElementById('editor-card');
const fileEditorsContainer = document.getElementById('file-editors-container');
const generateJsonButton = document.getElementById('generate-json-button');

const outputCard = document.getElementById('output-card');
const jsonOutputTextarea = document.getElementById('json-output');
const copyJsonButton = document.getElementById('copy-json-button');
const gotoWikiButton = document.getElementById('goto-wiki-button');
const outputMessage = document.getElementById('output-message');

const disclaimerElement = document.getElementById('disclaimer');

function updateUIStrings() {
    document.documentElement.lang = currentLang;
    pageTitleElement.textContent = _t('toolTitle');

    document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            if (el.placeholder) el.placeholder = _t(key);
            if (el.value && !el.dataset.dynamicValue) el.value = _t(key);
        } else if (el.tagName === 'LABEL' && el.htmlFor) {
            const textNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (textNode) textNode.textContent = _t(key, { MAX_FILES });
            else el.textContent = _t(key, { MAX_FILES });
        } else {
            el.textContent = _t(key);
        }
    });

    document.querySelector('label[for="filenames-fetch"]').textContent = _t('step1Label', { MAX_FILES: MAX_FILES });
    document.querySelector('label[for="json-output"]').textContent = _t('step3Label', { fileCount: 0, totalSize: 0 });
    disclaimerElement.innerHTML = _t('disclaimer');
}

function showMessage(element, msg, type = 'info') {
    element.innerHTML = msg;
    element.className = `message ${type}`;
    element.style.display = 'block';
}

async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
    });
}

function loadSettings() {
    const savedSettings = localStorage.getItem('wikiFetcherSettings');
    isInitialLoad = !savedSettings;

    if (savedSettings) {
        try {
            settings = JSON.parse(savedSettings);

            if (!settings.apiEndpoint) {
                isInitialLoad = true;
            }
        } catch (e) {
            console.error('Failed to parse saved settings:', e);
            isInitialLoad = true;
            settings = { lang: 'en', apiEndpoint: '', authKey: '' };
        }
    }

    if (!settings.lang || isInitialLoad) {
        const browserLang = navigator.language || navigator.userLanguage || 'en';
        settings.lang = browserLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }

    currentLang = settings.lang;
    languageSelect.value = currentLang;
    apiEndpointInput.value = settings.apiEndpoint || '';
    authKeyInput.value = settings.authKey || '';

    initializeApiClient();
    updateUIStrings();
    handleApiEndpointChange();
}

async function saveSettings() {
    const newApiEndpoint = apiEndpointInput.value.trim();
    if (!newApiEndpoint) {
        showMessage(settingsMessage, _t('settingsApiMissing'), 'error');
        return;
    }

    settings.lang = languageSelect.value;
    settings.apiEndpoint = newApiEndpoint;
    settings.authKey = authKeyInput.value.trim();

    try {
        localStorage.setItem('wikiFetcherSettings', JSON.stringify(settings));
        showMessage(settingsMessage, _t('settingsSaved'), 'success');
        isInitialLoad = false;
        setTimeout(() => {
            settingsMessage.style.display = 'none';
            closeSettingsModal();
        }, 1500);

        currentLang = settings.lang;
        await initializeApiClient();
        updateUIStrings();
    } catch (e) {
        console.error('Failed to save settings:', e);
        showMessage(settingsMessage, 'Error saving settings to local storage.', 'error');
    }
}

function openSettingsModal() {
    languageSelect.value = settings.lang || 'en';
    apiEndpointInput.value = settings.apiEndpoint || '';
    authKeyInput.value = settings.authKey || '';
    handleApiEndpointChange();
    settingsModal.style.display = 'flex';
    settingsMessage.style.display = 'none';
}

function closeSettingsModal() {
    if (isInitialLoad && !apiEndpointInput.value.trim()) {
        showMessage(settingsMessage, _t('initialSettingsRequired'), 'error');
        return;
    }
    settingsModal.style.display = 'none';
}

function handleApiEndpointChange() {
    if (apiEndpointInput.value.includes('huijiwiki.com')) {
        authKeyWarning.style.display = 'block';
    } else {
        authKeyWarning.style.display = 'none';
    }
}

async function initializeApiClient() {
    fetchButton.disabled = true;
    apiStatusDiv.textContent = _t('namespaceInfoLoading');
    if (settings.apiEndpoint) {
        const headers = {};
        if (settings.authKey) {
            headers['X-authkey'] = settings.authKey;
        }
        sourceWiki = new MediaWikiApi(settings.apiEndpoint, { headers: headers });
        console.log('Source API client initialized for:', settings.apiEndpoint);

        await fetchNamespaceInfo();
    } else {
        sourceWiki = null;
        fileNsCanonical = 'File';
        fileNsLocalized = '';
        apiStatusDiv.textContent = _t('fetchNeedsSettings');
        updateUIStrings();
    }
}

async function fetchNamespaceInfo() {
    if (!sourceWiki) return;
    try {
        const response = await sourceWiki.get({
            action: 'query',
            meta: 'siteinfo',
            siprop: 'namespaces',
            sifilteriw: 'local',
            format: 'json',
            formatversion: 2
        });
        const nsData = response.data?.query?.namespaces;
        const fileNs = nsData ? nsData['6'] : null;

        if (fileNs) {
            fileNsCanonical = fileNs.canonical || 'File';
            fileNsLocalized = fileNs.name || '';
            console.log(`Namespace 6: Canonical='${fileNsCanonical}', Localized='${fileNsLocalized}'`);
            apiStatusDiv.textContent = _t('namespaceInfoLoaded');
            fetchButton.disabled = false;
        } else {
            console.warn('Could not find namespace 6 (File) in API response.');
            fileNsCanonical = 'File';
            fileNsLocalized = '';
            apiStatusDiv.textContent = _t('namespaceInfoFailed');
            fetchButton.disabled = false;
        }
    } catch (error) {
        console.error('Failed to fetch namespace info:', error);
        showMessage(fetchMessage, _t('errorNamespaceFetch'), 'error');
        fileNsCanonical = 'File';
        fileNsLocalized = '';
        apiStatusDiv.textContent = _t('namespaceInfoFailed');
        fetchButton.disabled = false;
    }
    updateUIStrings();
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
}
const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(savedTheme);

themeToggle.addEventListener('click', () => {
    let currentTheme = document.documentElement.getAttribute('data-theme');
    applyTheme(currentTheme === 'light' ? 'dark' : 'light');
});

async function fetchFilesInfo() {
    if (!sourceWiki) {
        showMessage(fetchMessage, _t('fetchNeedsSettings'), 'error');
        openSettingsModal();
        return;
    }
    if (fetchButton.disabled) {
        showMessage(fetchMessage, _t('namespaceInfoLoading'), 'warning');
        return;
    }

    const filenames = filenamesFetchTextarea.value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (filenames.length === 0) {
        showMessage(fetchMessage, _t('fetchFileNameMissing'), 'error');
        return;
    }

    if (filenames.length > MAX_FILES) {
        showMessage(fetchMessage, _t('fetchLineLimitExceeded', { MAX_FILES: MAX_FILES }), 'error');
        return;
    }

    let prefixAdded = false;

    const processedFilenames = filenames.map((name) => {
        const canonicalPrefix = fileNsCanonical + ':';
        const localizedPrefix = fileNsLocalized ? fileNsLocalized + ':' : canonicalPrefix;

        if (!name.toLowerCase().startsWith(canonicalPrefix.toLowerCase()) && !name.toLowerCase().startsWith(localizedPrefix.toLowerCase())) {
            prefixAdded = true;
            return canonicalPrefix + name;
        }
        return name;
    });

    fetchMessage.style.display = 'none';

    if (prefixAdded) {
        filenamesFetchTextarea.value = processedFilenames.join('\n');

        showMessage(fetchMessage, _t('fetchPrefixAdded', { prefix: fileNsCanonical }), 'warning');
    }

    fetchButton.disabled = true;
    generateJsonButton.disabled = true;
    editorCard.style.display = 'none';
    outputCard.style.display = 'none';
    fileEditorsContainer.innerHTML = '';
    fetchedFilesData = [];
    totalFetchedSize = 0;
    fileSizeInfo.textContent = '';

    const currentFetchMsg = fetchMessage.innerHTML;
    showMessage(fetchMessage, (currentFetchMsg ? currentFetchMsg + '<br>' : '') + _t('fetchingMessage', { count: processedFilenames.length }), 'info');

    let successCount = 0;

    const results = await Promise.allSettled(processedFilenames.map((filename) => fetchSingleFileInfo(filename)));

    results.forEach((result, index) => {
        const originalFilename = processedFilenames[index];
        if (result.status === 'fulfilled') {
            const data = result.value;
            fetchedFilesData.push({
                ...data,
                originalFilename: originalFilename,
                elementId: `file-editor-${index}`
            });
            totalFetchedSize += data.fileObject.size;
            successCount++;
            displayFileEditor(fetchedFilesData[fetchedFilesData.length - 1]);
        } else {
            console.error(`Failed to fetch ${originalFilename}:`, result.reason);

            const errMsg = result.reason.message || _t('errorGenericFetch');

            fetchMessage.innerHTML += `<br><span style="color:var(--error-text);">Failed (${originalFilename}): ${errMsg}</span>`;
            fetchMessage.className = 'message error';
        }
    });

    const totalSizeMB = (totalFetchedSize / (1024 * 1024)).toFixed(2);
    fileSizeInfo.textContent = `Total file size: ${totalSizeMB} MB`;

    if (successCount > 0) {
        editorCard.style.display = 'block';
        generateJsonButton.disabled = false;

        if (successCount === processedFilenames.length) {
            showMessage(fetchMessage, _t('fetchCompleteMessage', { successCount: successCount, totalCount: processedFilenames.length }), 'success');
        } else {
            fetchMessage.innerHTML = _t('fetchCompleteMessage', { successCount: successCount, totalCount: processedFilenames.length }) + fetchMessage.innerHTML.substring(fetchMessage.innerHTML.indexOf('<br>'));
            fetchMessage.className = 'message warning';
        }
    } else if (processedFilenames.length > 0) {
        if (!fetchMessage.innerHTML.includes('Failed')) {
            showMessage(fetchMessage, _t('errorGenericFetch') + ': All files failed.', 'error');
        }
    }

    fetchButton.disabled = false;
}

async function fetchSingleFileInfo(filename) {
    console.log(`Fetching: ${filename}`);
    showMessage(fetchMessage, _t('fetchingSingleMessage', { filename: filename }), 'info', true);

    try {
        const fullResponse = await sourceWiki.get({
            action: 'query',
            prop: 'imageinfo|revisions',
            titles: filename,
            iiprop: 'url|size|mime',
            rvprop: 'content'
        });

        const resultData = fullResponse.data;

        if (!resultData || !resultData.query || !resultData.query.pages) {
            if (resultData && resultData.error) throw new Error(`${_t('errorApiGeneric')}: ${resultData.error.info}`);
            throw new Error(_t('errorApiStructure'));
        }

        const pages = resultData.query.pages;
        const page = pages[0];

        if (!page || page.missing) {
            throw new Error(_t('errorFileNotFound', { filename: filename }));
        }

        const imageInfo = page.imageinfo && page.imageinfo[0];
        if (!imageInfo || !imageInfo.url) {
            throw new Error(_t('errorImageInfoMissing', { filename: filename }));
        }

        const fileUrl = imageInfo.url;
        const fileSize = imageInfo.size;
        const mimeType = imageInfo.mime;
        const fetchedFilenameRaw = page.title;

        const revision = page.revisions?.[0];
        const originalWikitext = revision?.content || revision?.slots?.main?.content || '';

        let processedWikitext = originalWikitext;
        const pattern1 = '文件来源|';
        const pattern2 = '文件来源|1=';
        let sourceContent = null;

        let index1 = originalWikitext.indexOf(pattern1);
        let index2 = originalWikitext.indexOf(pattern2);
        let startIndex = -1;
        let patternLength = 0;

        if (index1 !== -1 && (index2 === -1 || index1 < index2)) {
            startIndex = index1;
            patternLength = pattern1.length;
        } else if (index2 !== -1) {
            startIndex = index2;
            patternLength = pattern2.length;
        }

        if (startIndex !== -1) {
            const contentStart = startIndex + patternLength;
            const endIndex = originalWikitext.indexOf('}}', contentStart);
            if (endIndex !== -1) {
                sourceContent = originalWikitext.substring(contentStart, endIndex).trim();

                processedWikitext = `== Summary ==\n{{fi|s=${sourceContent}}}\n== Licensing ==\n{{fairuse}}`;
                console.log(`Processed wikitext for ${filename}, extracted source: ${sourceContent}`);
            } else {
                console.log(`Found '文件来源' but no closing '}}' for ${filename}, keeping original wikitext.`);
            }
        } else if (originalWikitext.trim() === '') {
            processedWikitext = DEFAULT_EMPTY_WIKITEXT;
            console.log(`Original wikitext empty for ${filename}, using default template.`);
        }

        const targetFilenameStandardized = fetchedFilenameRaw.replace(/^(?:File|文件|[^:]+):/i, 'File:');

        showMessage(fetchMessage, `Downloading ${filename}…`, 'info', true);
        const fileBlobResponse = await fetch(fileUrl);
        if (!fileBlobResponse.ok) {
            throw new Error(`HTTP error ${fileBlobResponse.status} downloading ${filename}`);
        }
        const fileBlob = await fileBlobResponse.blob();

        const safeFileTitle = targetFilenameStandardized.replace(/^File:/i, '').trim();
        const fileObject = new File([fileBlob], safeFileTitle, { type: mimeType });

        return {
            fetchedFilename: fetchedFilenameRaw,
            targetFilenameStandardized: targetFilenameStandardized,
            processedWikitext: processedWikitext,
            fileUrl: fileUrl,
            fileObject: fileObject,
            mimeType: mimeType
        };
    } catch (error) {
        console.error(`Error processing ${filename}:`, error);

        const apiErrorMatch = error.message.match(/API Error: (.*)/);
        if (apiErrorMatch) {
            throw new Error(`${_t('errorApiGeneric')}: ${apiErrorMatch[1]}`);
        }
        throw new Error(error.message || _t('errorGenericFetch'));
    }
}

function displayFileEditor(fileInfo) {
    const editorDiv = document.createElement('div');
    editorDiv.className = 'file-editor-item';
    editorDiv.id = fileInfo.elementId;

    editorDiv.innerHTML = `
                            <h3>${fileInfo.fetchedFilename}</h3> <div class="form-group">
                                <label for="${fileInfo.elementId}-filename">${_t('targetFilenameLabel')}</label>
                                <input type="text" id="${fileInfo.elementId}-filename" value="${fileInfo.targetFilenameStandardized}"> </div>
                            <div class="form-group">
                                <label for="${fileInfo.elementId}-desc">${_t('descriptionLabel')}</label>
                                <textarea id="${fileInfo.elementId}-desc">${fileInfo.processedWikitext}</textarea> </div>
                            <div class="form-group">
                                <label>${_t('previewLabel')}</label>
                                <div class="preview-area">
                                    <img id="${fileInfo.elementId}-preview" src="${fileInfo.fileUrl}" alt="${fileInfo.fetchedFilename} preview" style="display: block;">
                                    <span id="${fileInfo.elementId}-placeholder" style="display: none;">${_t('previewPlaceholder')}</span>
                                </div>
                            </div>
                        `;
    fileEditorsContainer.appendChild(editorDiv);

    const imgPreview = editorDiv.querySelector(`#${fileInfo.elementId}-preview`);
    imgPreview.onerror = () => {
        imgPreview.style.display = 'none';
        const placeholder = editorDiv.querySelector(`#${fileInfo.elementId}-placeholder`);
        placeholder.textContent = _t('previewFailed');
        placeholder.style.display = 'inline';
    };
}

async function generateJson() {
    if (fetchedFilesData.length === 0) {
        showMessage(outputMessage, 'No file data available to generate JSON.', 'error');
        return;
    }

    generateJsonButton.disabled = true;
    outputCard.style.display = 'none';
    showMessage(outputMessage, _t('generatingJsonMessage'), 'info');

    const outputFiles = [];
    let currentTotalSize = 0;
    const sizeWarningThreshold = 10 * 1024 * 1024;

    try {
        for (const fileInfo of fetchedFilesData) {
            const editorElement = document.getElementById(fileInfo.elementId);
            if (!editorElement) {
                console.warn(`Editor element not found for ${fileInfo.originalFilename}, skipping.`);
                continue;
            }

            const targetFilename = editorElement.querySelector(`#${fileInfo.elementId}-filename`).value.trim();
            const description = editorElement.querySelector(`#${fileInfo.elementId}-desc`).value;

            if (!targetFilename) {
                throw new Error(`Target filename cannot be empty for ${fileInfo.originalFilename}.`);
            }

            showMessage(outputMessage, `Converting ${targetFilename} to Base64…`, 'info');
            let base64Data;
            try {
                base64Data = await blobToBase64(fileInfo.fileObject);
            } catch (err) {
                throw new Error(_t('base64Error', { filename: targetFilename }));
            }

            outputFiles.push({
                filename: targetFilename,
                wikitext: description,
                mime_type: fileInfo.mimeType,
                base64: base64Data
            });
            currentTotalSize += fileInfo.fileObject.size;
        }

        const jsonData = {
            upload_metadata: {
                version: '1.0',
                exported_time: new Date().toISOString(),
                total_size_bytes: currentTotalSize
            },
            files: outputFiles
        };

        const jsonString = JSON.stringify(jsonData, null, 2);
        jsonOutputTextarea.value = jsonString;

        const totalSizeMB = (currentTotalSize / (1024 * 1024)).toFixed(2);
        document.querySelector('label[for="json-output"]').textContent = _t('step3Label', { fileCount: outputFiles.length, totalSize: totalSizeMB });

        outputCard.style.display = 'block';
        showMessage(outputMessage, _t('jsonGeneratedMessage'), 'success');

        if (currentTotalSize > sizeWarningThreshold) {
            showMessage(outputMessage, _t('fileSizeWarning', { totalSize: totalSizeMB }), 'warning');
        }
    } catch (error) {
        console.error('Error generating JSON:', error);
        showMessage(outputMessage, `${_t('errorGenericGenerate')}: ${error.message}`, 'error');
    } finally {
        generateJsonButton.disabled = false;
    }
}

function copyJson() {
    if (!jsonOutputTextarea.value) return;
    navigator.clipboard
        .writeText(jsonOutputTextarea.value)
        .then(() => {
            showMessage(outputMessage, _t('copySuccessMessage'), 'success');
            setTimeout(() => {
                if (!outputMessage.classList.contains('warning')) {
                    showMessage(outputMessage, _t('jsonGeneratedMessage'), 'success');
                }
            }, 2000);
        })
        .catch((err) => {
            console.error('Failed to copy JSON:', err);
            showMessage(outputMessage, _t('copyErrorMessage'), 'error');
        });
}

function gotoWiki() {
    window.open(TARGET_WIKI_PASTE_URL, '_blank');
}

settingsButton.addEventListener('click', openSettingsModal);
closeSettingsButton.addEventListener('click', closeSettingsModal);
saveSettingsButton.addEventListener('click', saveSettings);
apiEndpointInput.addEventListener('input', handleApiEndpointChange);
languageSelect.addEventListener('change', () => {
    settings.lang = languageSelect.value;
    currentLang = settings.lang;
    updateUIStrings();
});

fetchButton.addEventListener('click', fetchFilesInfo);
generateJsonButton.addEventListener('click', generateJson);
copyJsonButton.addEventListener('click', copyJson);
gotoWikiButton.addEventListener('click', gotoWiki);

window.addEventListener('click', (event) => {
    if (event.target == settingsModal) {
        closeSettingsModal();
    }
});

loadSettings();
if (isInitialLoad) {
    setTimeout(openSettingsModal, 100);
}
