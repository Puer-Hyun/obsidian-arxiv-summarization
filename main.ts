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
                    console.log('사전 검사 결과:', preCheckResult);
                    
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

    async insertSummary(summary: string) {
        if (this.activeFile) {
            const content = await this.app.vault.read(this.activeFile);
            const newContent = content + '\n\n' + summary;
            await this.app.vault.modify(this.activeFile, newContent);
            new Notice('요약이 성공적으로 삽입되었습니다.');
        } else {
            new Notice('요약을 삽입할 파일을 찾을 수 없습니다.');
        }
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
            await this.plugin.insertSummary(summary);
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