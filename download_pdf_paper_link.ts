import { App, Notice, TFile, requestUrl } from 'obsidian';
import MyPlugin from './main';

export class PaperDownloader {
    private app: App;
    private plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        console.log('PaperDownloader constructor called');
        this.app = app;
        this.plugin = plugin;
    }

    async downloadPaper() {
        try {
            console.log('downloadPaper method called');
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                console.log('No active file');
                new Notice('활성화된 파일이 없습니다.');
                return;
            }

            const frontmatter = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
            if (!frontmatter || !frontmatter.paper_link) {
                new Notice('paper_link를 찾을 수 없습니다.');
                return;
            }

            const paperLink = frontmatter.paper_link;
            const arxivId = this.extractArxivId(paperLink);
            if (!arxivId) {
                new Notice('유효한 ArXiv ID를 찾을 수 없습니다.');
                return;
            }

            const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;

            const response = await requestUrl({ url: pdfUrl, method: 'GET' });
            if (response.status !== 200) {
                throw new Error(`PDF 다운로드 실패: ${response.status}`);
            }

            const pdfData = response.arrayBuffer;
            const fileName = `${arxivId}.pdf`;

            const paperPath = this.plugin.settings.paperPaths.trim();
            if (!paperPath) {
                new Notice('Paper download path가 설정되지 않았습니다.');
                return;
            }

            // Ensure the directory exists
            await this.app.vault.adapter.mkdir(paperPath);

            const fullPath = `${paperPath}/${fileName}`;
            await this.app.vault.adapter.writeBinary(fullPath, pdfData);
            new Notice(`논문이 다운로드되었습니다: ${fullPath}`);

            // 파일에 다운로드 정보 추가
            let content = await this.app.vault.read(activeFile);
            content += `\n\n## Downloaded PDF\n- [[${fullPath}|${fileName}]]`;
            await this.app.vault.modify(activeFile, content);

        } catch (error) {
            console.error('Error in downloadPaper:', error);
            new Notice('PDF 다운로드 중 오류가 발생했습니다: ' + error.message);
        }
    }

    private extractArxivId(url: string): string | null {
        const match = url.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
        return match ? match[1] : null;
    }
}
