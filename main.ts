import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl, WorkspaceLeaf, TFile } from 'obsidian';

interface MyPluginSettings {
    openaiApiKey: string;
    translate: boolean;
    targetLanguage: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    openaiApiKey: '',
    translate: false,
    targetLanguage: '한국어'
}

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;
    loadingIndicator: HTMLElement | null = null;
    activeFile: TFile | null = null;
    private metadataCache: Map<string, string> = new Map();

    async onload() {
        await this.loadSettings();

        this.addRibbonIcon('dice', 'Arxiv Summarization', (evt: MouseEvent) => {
            new ArxivSummarizationModal(this.app, this).open();
        });

        this.addCommand({
            id: 'open-arxiv-summarization-modal',
            name: 'Summarize Arxiv Paper',
            callback: () => {
                new ArxivSummarizationModal(this.app, this).open();
            }
        });

        // Arxiv 메타데이터 가져오기 명령어 추가
        this.addCommand({
            id: 'fetch-arxiv-metadata',
            name: 'Arxiv 메타데이터 가져오기',
            callback: () => {
                new ArxivMetadataModal(this.app, this).open();
            }
        });

        // Ollama로 요약하기 명령어 추가
        this.addCommand({
            id: 'summarize-with-ollama',
            name: 'Ollama로 요약하기',
            callback: () => {
                new OllamaSummarizationModal(this.app, this).open();
            }
        });

        this.addSettingTab(new SampleSettingTab(this.app, this));
    }

    async summarizeArxiv(url: string, file: TFile): Promise<string> {
        this.activeFile = file;
        try {
            console.log('사전 검사 요청 시작:', url);
            
            // 사전 검사 요청
            const preCheckResponse = await requestUrl({
                url: 'https://lqjltyh9ah.execute-api.ap-southeast-2.amazonaws.com/obsidian-summarization-v1/check',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: url,
                    target_language: this.settings.targetLanguage,
                    status: "COMPLETED"
                }),
                throw: false // 오류 발생 시 예외를 던지지 않고 응답 객체를 반환합니다.
            });
    
            console.log('사전 검사 응답:', preCheckResponse);
    
            // 응답 처리
            if (preCheckResponse.status === 200 && preCheckResponse.text) {
                try {
                    const preCheckResult = JSON.parse(preCheckResponse.text);
                    console.log('사전 검사 과:', preCheckResult);
                    
                    if (preCheckResult.result) {
                        const parsedResult = JSON.parse(preCheckResult.result);
                        console.log('사전 검사 성공, 결과 반환');
                        return this.formatSummary(parsedResult, url);
                    }
                } catch (error) {
                    console.error('사전 검사 결과 파싱 오류:', error);
                }
            } else {
                console.log('사전 검사 실패 또는 응답 없음:', preCheckResponse.status, preCheckResponse.text);
            }
    
            console.log('사전 검사 실패 또는 데이터 없음, 기존 로직 시작');
    
            // 기존 로직 시작
            const response = await requestUrl({
                url: 'https://lqjltyh9ah.execute-api.ap-southeast-2.amazonaws.com/obsidian-summarization-v1/service',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: url,
                    api_key: this.settings.openaiApiKey,
                    translate: this.settings.translate,
                    target_language: this.settings.targetLanguage
                })
            });
    
            console.log('summarizeArxiv 응답:', response.status, response.text);
    
            if (response.status !== 202) {
                console.error('요약 요청 실패:', response);
                throw new Error(`요약 요청 실패: ${response.status} - ${response.text}`);
            }
    
            const responseData = JSON.parse(response.text);
            const requestId = responseData.request_id;
    
            await new Promise(resolve => setTimeout(resolve, 2000));
    
            return await this.pollForResult(requestId);
        } catch (error) {
            console.error('summarizeArxiv 오류:', error);
            throw error;
        }
    }

    async pollForResult(requestId: string, maxAttempts = 60, initialInterval = 1000): Promise<string> {
        let interval = initialInterval;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const response = await requestUrl({
                    url: `https://lqjltyh9ah.execute-api.ap-southeast-2.amazonaws.com/obsidian-summarization-v1/status`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        requestId: requestId
                    })
                });

                console.log(`Polling attempt ${attempt + 1}:`, response.status, response.text);

                if (response.status === 200) {
                    const result = JSON.parse(response.text);
                    if (result.status === 'COMPLETED') {
                        const parsedResult = JSON.parse(result.result);
                        return this.formatSummary(parsedResult, result.url);
                    } else if (result.status === 'ERROR') {
                        throw new Error('요약 처리 중 오류 발생: ' + result.error);
                    }
                } else {
                    console.error(`Unexpected response status: ${response.status}`, response.text);
                    throw new Error(`Unexpected response status: ${response.status}`);
                }
            } catch (error) {
                console.error(`Polling error:`, error);
                throw error;
            }

            await new Promise(resolve => setTimeout(resolve, interval));
            interval = Math.min(interval * 1.5, 10000);
        }

        throw new Error('요약 시간 초과');
    }

    formatSummary(result: any, url: string): string {
        let decodedSummary;
        try {
            decodedSummary = result.summary.replace(/\\n/g, '\n').replace(/\\"/g, '"');
        } catch (error) {
            console.error('Summary parsing error:', error);
            decodedSummary = JSON.stringify(result);
        }

        return `## Arxiv 논문 요약\n\n원본 URL: ${url}\n\n### 요약\n${decodedSummary}\n\n---\n이 요약은 AI에 의해 생성되었으며, 부정확할 수 있습니다. 자세한 내용은 원본 논문을 참조하세요.`;
    }

    getActiveMarkdownEditor(): Editor | null {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        return view ? view.editor : null;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    showLoadingIndicator() {
        console.log('Showing loading indicator');
        if (this.loadingIndicator) return;
        this.loadingIndicator = document.createElement('div');
        this.loadingIndicator.addClass('arxiv-summarization-loading');
        this.loadingIndicator.innerHTML = `
            <div class="spinner"></div>
            <div class="message">요약 작업 중입니다. 이 작업은 시간이 걸릴 수 있습니다.</div>
        `;
        document.body.appendChild(this.loadingIndicator);
        console.log('Loading indicator added to DOM');
    }

    hideLoadingIndicator() {
        if (this.loadingIndicator) {
            this.loadingIndicator.remove();
            this.loadingIndicator = null;
        }
    }

    async insertSummary(summary: string, file: TFile) {
        if (file) {
            const content = await this.app.vault.read(file);
            const newContent = content + '\n\n' + summary;
            await this.app.vault.modify(file, newContent);
            new Notice('메타데이터가 성공적으로 삽입되었습니다.');
        } else {
            new Notice('메타데이터를 삽입할 파일을 찾을 수 없습니다.');
        }
    }

    async fetchArxivMetadata(url: string): Promise<string> {
        const arxivId = this.extractArxivId(url);
        if (!arxivId) {
            throw new Error('유효한 Arxiv URL이 아닙니다.');
        }

        // 캐시 확인
        const cachedMetadata = this.metadataCache.get(arxivId);
        if (cachedMetadata) {
            return cachedMetadata;
        }

        const apiUrl = `https://export.arxiv.org/api/query?id_list=${arxivId}`;
        
        try {
            const response = await requestUrl({
                url: apiUrl,
                headers: {
                    'User-Agent': 'ObsidianArxivPlugin/1.0 (https://github.com/yourusername/your-plugin-repo; mailto:your-email@example.com)'
                }
            });

            if (response.status !== 200) {
                throw new Error(`Arxiv API 요청 실패: ${response.status}`);
            }

            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(response.text, "text/xml");

            const entry = xmlDoc.querySelector('entry');
            if (!entry) {
                throw new Error('논문 정보를 찾을 수 없습니다.');
            }

            const title = entry.querySelector('title')?.textContent?.trim() || '제목 없음';
            const paperLink = entry.querySelector('id')?.textContent || url;
            const publishDate = entry.querySelector('published')?.textContent?.split('T')[0] || '날짜 없음';
            const authors = Array.from(entry.querySelectorAll('author name'))
                .map(author => author.textContent)
                .join(', ');
            const abstract = entry.querySelector('summary')?.textContent?.trim() || '초록 없음';

            const metadata = this.formatMetadata(title, paperLink, publishDate, authors, abstract);
            
            // 캐시에 저장
            this.metadataCache.set(arxivId, metadata);

            return metadata;
        } catch (error) {
            console.error('Arxiv 메타데이터 가져오기 오류:', error);
            throw new Error('Arxiv 메타데이터를 가져오는 중 오류가 발생했습니다.');
        }
    }

    extractArxivId(url: string): string | null {
        const match = url.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
        return match ? match[1] : null;
    }

    formatMetadata(title: string, paperLink: string, publishDate: string, authors: string, abstract: string): string {
        return `## ${title}

- **링크:** ${paperLink}
- **출판일:** ${publishDate}
- **저자:** ${authors}

### 초록
${abstract}

---
이 메타데이터는 Arxiv API를 통해 자동으로 가져왔습니다.`;
    }

    async summarizeWithOllama(url: string): Promise<string> {
        // Ollama API를 사용한 요약 로직 구현
        // 이 부분은 Ollama API의 구체적인 사용 방법에 따라 구현해야 합니다.
        throw new Error('Ollama 요약 기능이 아직 구현되지 않았습니다.');
    }
}

class ArxivSummarizationModal extends Modal {
    plugin: MyPlugin;
    inputEl: HTMLInputElement;

    constructor(app: App, plugin: MyPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.createEl('h2', {text: 'Enter Arxiv URL'});

        this.inputEl = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Please enter the Arxiv URL'
        });
        this.inputEl.style.width = '100%';
        this.inputEl.style.height = '40px';
        this.inputEl.style.fontSize = '16px';
        this.inputEl.style.padding = '5px';
        this.inputEl.style.marginBottom = '10px';

        this.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                this.onSummarize();
            }
        });

        const buttonEl = contentEl.createEl('button', {text: 'Summarize'});
        buttonEl.style.width = '100%';
        buttonEl.style.height = '40px';
        buttonEl.style.fontSize = '16px';
        buttonEl.addEventListener('click', this.onSummarize.bind(this));
    }

    async onSummarize() {
        const url = this.inputEl.value.trim();
        if (!url) {
            new Notice('유효한 URL을 입력해주세요');
            return;
        }

        if (!this.plugin.settings.openaiApiKey) {
            new Notice('OpenAI API 키를 설정해주세요');
            return;
        }

        const urlPattern = /^https:\/\/arxiv\.org\/.+/i;
        if (!urlPattern.test(url)) {
            new Notice('유효한 Arxiv URL을 입력해주세요 (https://arxiv.org/로 시작해야 합니다)');
            return;
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('활성화된 마크다운 파일이 없습니다.');
            return;
        }

        this.close(); // 모달 닫기
        this.plugin.showLoadingIndicator(); // 로딩 인디케이터 표시

        try {
            const summary = await this.plugin.summarizeArxiv(url, activeFile);
            await this.plugin.insertSummary(summary, activeFile);
        } catch (error) {
            new Notice('오류: ' + error.message);
        } finally {
            this.plugin.hideLoadingIndicator(); // 로딩 인디케이터 숨기기
        }
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

class ArxivMetadataModal extends Modal {
    plugin: MyPlugin;
    inputEl: HTMLInputElement;

    constructor(app: App, plugin: MyPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.createEl('h2', {text: 'Arxiv URL 입력'});

        this.inputEl = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'https://arxiv.org/abs/XXXX.XXXXX'
        });
        this.inputEl.style.width = '100%';
        this.inputEl.style.height = '40px';
        this.inputEl.style.fontSize = '16px';
        this.inputEl.style.padding = '5px';
        this.inputEl.style.marginBottom = '10px';

        this.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                this.onFetchMetadata();
            }
        });

        const buttonEl = contentEl.createEl('button', {text: '메타데이터 가져오기'});
        buttonEl.style.width = '100%';
        buttonEl.style.height = '40px';
        buttonEl.style.fontSize = '16px';
        buttonEl.addEventListener('click', this.onFetchMetadata.bind(this));
    }

    async onFetchMetadata() {
        const url = this.inputEl.value.trim();
        if (!url) {
            new Notice('유효한 URL을 입력해주세요');
            return;
        }

        const urlPattern = /^https:\/\/arxiv\.org\/abs\/.+/i;
        if (!urlPattern.test(url)) {
            new Notice('유효한 Arxiv URL을 입력해주세요 (https://arxiv.org/abs/로 시작해야 합니다)');
            return;
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('활성화된 마크다운 파일이 없습니다.');
            return;
        }

        this.close();
        this.plugin.showLoadingIndicator();

        try {
            const metadata = await this.plugin.fetchArxivMetadata(url);
            await this.plugin.insertSummary(metadata, activeFile);
            new Notice('메타데이터가 성공적으로 삽입되었습니다.');
        } catch (error) {
            new Notice('오류: ' + error.message);
        } finally {
            this.plugin.hideLoadingIndicator();
        }
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

class OllamaSummarizationModal extends Modal {
    plugin: MyPlugin;
    inputEl: HTMLInputElement;

    constructor(app: App, plugin: MyPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.createEl('h2', {text: 'Arxiv URL 입력 (Ollama 요약)'});

        this.inputEl = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'https://arxiv.org/abs/XXXX.XXXXX'
        });
        this.inputEl.style.width = '100%';
        this.inputEl.style.height = '40px';
        this.inputEl.style.fontSize = '16px';
        this.inputEl.style.padding = '5px';
        this.inputEl.style.marginBottom = '10px';

        this.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                this.onSummarize();
            }
        });

        const buttonEl = contentEl.createEl('button', {text: 'Ollama로 요약하기'});
        buttonEl.style.width = '100%';
        buttonEl.style.height = '40px';
        buttonEl.style.fontSize = '16px';
        buttonEl.addEventListener('click', this.onSummarize.bind(this));
    }

    async onSummarize() {
        const url = this.inputEl.value.trim();
        if (!url) {
            new Notice('유효한 URL을 입력해주세요');
            return;
        }

        const urlPattern = /^https:\/\/arxiv\.org\/abs\/.+/i;
        if (!urlPattern.test(url)) {
            new Notice('유효한 Arxiv URL을 입력해주세요 (https://arxiv.org/abs/로 시작해야 합니다)');
            return;
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('활성화된 마크다운 파일이 없습니다.');
            return;
        }

        this.close();
        this.plugin.showLoadingIndicator();

        try {
            const summary = await this.plugin.summarizeWithOllama(url);
            await this.plugin.insertSummary(summary, activeFile);
        } catch (error) {
            new Notice('오류: ' + error.message);
        } finally {
            this.plugin.hideLoadingIndicator();
        }
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

class SampleSettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Enter your OpenAI API key')
            .addText(text => text
                .setPlaceholder('sk-...')
                .setValue(this.plugin.settings.openaiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openaiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('번역 활성화')
            .setDesc('요약문을 번역할지 선택합니다.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.translate)
                .onChange(async (value) => {
                    this.plugin.settings.translate = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.translate) {
            new Setting(containerEl)
                .setName('목표 언어')
                .setDesc('번역할 언어를 선택합니다.')
                .addDropdown(dropdown => dropdown
                    .addOption('한국어', '한국어')
                    .addOption('Japanese', '일본어')
                    .addOption('Chinese', '중국어')
                    .addOption('Spanish', '스페인어')
                    .addOption('French', '프랑스어')
                    .addOption('German', '독일어')
                    .setValue(this.plugin.settings.targetLanguage)
                    .onChange(async (value) => {
                        this.plugin.settings.targetLanguage = value;
                        await this.plugin.saveSettings();
                    }));
        }
    }
}