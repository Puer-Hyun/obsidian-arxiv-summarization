import { App, Notice, TFile, requestUrl } from 'obsidian';
import MyPlugin from './main';

export class ArxivSummarizer {
    private app: App;
    private plugin: MyPlugin;
    private loadingIndicator: HTMLElement | null = null;

    constructor(app: App, plugin: MyPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async summarizeFromClipboard() {
        try {
            const clipboardText = await navigator.clipboard.readText();
            const url = this.normalizeArxivUrl(clipboardText.trim());
            
            if (!this.isValidArxivUrl(url)) {
                throw new Error('클립보드의 내용이 유효한 Arxiv URL이 아닙니다.');
            }

            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                throw new Error('활성화된 마크다운 파일이 없습니다.');
            }

            this.showLoadingIndicator();

            const summary = await this.summarizeArxiv(url, activeFile);
            await this.insertSummary(summary, activeFile);
            new Notice('요약이 성공적으로 삽입되었습니다.');
        } catch (error) {
            new Notice('오류: ' + error.message);
        } finally {
            this.hideLoadingIndicator();
        }
    }

    private normalizeArxivUrl(url: string): string {
        url = url.replace(/^http:/, 'https:');
        url = url.replace(/arxiv\.org\/pdf/, 'arxiv.org/abs');
        url = url.replace(/\.pdf$/, '');
        return url;
    }

    private isValidArxivUrl(url: string): boolean {
        const urlPattern = /^https:\/\/arxiv\.org\/abs\/.+/i;
        return urlPattern.test(url);
    }

    async summarizeArxiv(url: string, file: TFile): Promise<string> {
        url = this.normalizeArxivUrl(url);
        if (!this.isValidArxivUrl(url)) {
            throw new Error('유효한 Arxiv URL이 아닙니다.');
        }

        try {
            console.log('사전 검사 요청 시작:', url);
            
            const preCheckResponse = await requestUrl({
                url: 'https://lqjltyh9ah.execute-api.ap-southeast-2.amazonaws.com/obsidian-summarization-v1/check',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: url,
                    target_language: this.plugin.settings.targetLanguage,
                    status: "COMPLETED"
                }),
                throw: false
            });
    
            console.log('사전 검사 응답:', preCheckResponse);
    
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
    
            const response = await requestUrl({
                url: 'https://lqjltyh9ah.execute-api.ap-southeast-2.amazonaws.com/obsidian-summarization-v1/service',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: url,
                    api_key: this.plugin.settings.openaiApiKey,
                    translate: this.plugin.settings.translate,
                    target_language: this.plugin.settings.targetLanguage
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
            new Notice('요약이 성공적으로 삽입되었습니다.');
        } else {
            new Notice('요약을 삽입할 파일을 찾을 수 없습니다.');
        }
    }
}
