import { App, Notice, TFile, requestUrl, Modal, Setting } from 'obsidian';
import MyPlugin from './main';

export class ArxivMetadata {
    private app: App;
    private plugin: MyPlugin;
    private metadataCache: Map<string, string> = new Map();

    constructor(app: App, plugin: MyPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async fetchMetadataFromClipboard() {
        try {
            const clipboardText = await navigator.clipboard.readText();
            const url = this.normalizeArxivUrl(clipboardText.trim());
            
            if (!this.isValidArxivUrl(url)) {
                throw new Error('클립보드의 내용이 유효한 Arxiv URL이 아닙니다.');
            }

            let activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                const fileName = `Arxiv Paper - ${new Date().toISOString().split('T')[0]}.md`;
                activeFile = await this.app.vault.create(fileName, "");
                new Notice(`새 파일이 생성되었습니다: ${fileName}`);
            }

            const metadata = await this.fetchArxivMetadata(url);
            await this.insertMetadata(metadata, activeFile);
            new Notice('메타데이터가 성공적으로 삽입되었습니다.');
        } catch (error) {
            new Notice('오류: ' + error.message);
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

    async fetchArxivMetadata(url: string): Promise<ArxivMetadataType> {
        url = this.normalizeArxivUrl(url);
        const arxivId = this.extractArxivId(url);
        if (!arxivId) {
            throw new Error('유효한 Arxiv URL이 아닙니다.');
        }

        const cachedMetadata = this.metadataCache.get(arxivId);
        if (cachedMetadata) {
            return JSON.parse(cachedMetadata);
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

            const title = entry.querySelector('title')?.textContent?.trim().replace(/\s+/g, ' ') || '제목 없음';
            const paperLink = entry.querySelector('id')?.textContent || url;
            const publishDate = entry.querySelector('published')?.textContent?.split('T')[0] || '날짜 없음';
            const authors = Array.from(entry.querySelectorAll('author name'))
                .map(author => author.textContent)
                .join(', ');
            const abstract = entry.querySelector('summary')?.textContent?.trim()
                .replace(/\n+/g, '\n')  // 연속된 줄바꿈을 하나로 줄임
                .replace(/\s+/g, ' ')   // 각 줄에서 연속된 공백을 하나로 줄임
                .split('\n')            // 줄바꿈으로 분리
                .map(para => para.trim())  // 각 단의 앞뒤 공백 제거
                .join('\n\n') || 'Abstract 없음';  // 단락 사이에 빈 줄 추가

            console.log('Fetched metadata:', { title, paperLink, publishDate, authors, abstract });

            const metadata: ArxivMetadataType = {
                title,
                paperLink,
                publishDate,
                authors,
                abstract
            };

            // Semantic Scholar API를 사용하여 인용 정보 가져오기
            const citationInfo = await this.fetchCitationInfo(arxivId);
            metadata.numCitedBy = citationInfo.numCitedBy;
            metadata.numCiting = citationInfo.numCiting;
            metadata.influentialCitations = citationInfo.influentialCitations;
            metadata.influentialReferences = citationInfo.influentialReferences;

            this.metadataCache.set(arxivId, JSON.stringify(metadata));

            return metadata;
        } catch (error) {
            console.error('Arxiv 메타데이터 가져오기 오류:', error);
            throw new Error('Arxiv 메타데이터를 가져오는 중 오류가 발생했습니다.');
        }
    }

    async fetchCitationInfo(arxivId: string): Promise<{ numCitedBy: number, numCiting: number, influentialCitations: any[], influentialReferences: any[] }> {
        const semanticScholarId = `arXiv:${arxivId}`;
        const url = `https://api.semanticscholar.org/v1/paper/${semanticScholarId}`;

        try {
            const response = await requestUrl({ url });
            if (response.status === 200) {
                const data = JSON.parse(response.text);
                const influentialCitations = this.getInfluentialPapers(data.citations);
                const influentialReferences = this.getInfluentialPapers(data.references);

                console.log('영향력 있는 인용:', JSON.stringify(influentialCitations, null, 2));
                console.log('영향력 있는 참조:', JSON.stringify(influentialReferences, null, 2));

                return {
                    numCitedBy: data.numCitedBy || 0,
                    numCiting: data.numCiting || 0,
                    influentialCitations,
                    influentialReferences
                };
            }
        } catch (error) {
            console.error(`Error fetching citation info for ${arxivId}:`, error);
        }

        return { numCitedBy: 0, numCiting: 0, influentialCitations: [], influentialReferences: [] };
    }

    private getInfluentialPapers(papers: any[]): any[] {
        return papers
            .filter(paper => paper.isInfluential)
            .map(paper => {
                const result = {
                    paperId: paper.paperId,
                    title: paper.title,
                    url: paper.url,
                    venue: paper.venue,
                    year: paper.year,
                    authors: paper.authors?.map((author: any) => author.name).join(', ') || '',
                    arxivId: paper.arxivId,
                    doi: paper.doi,
                    isInfluential: paper.isInfluential,
                    citationCount: paper.citationCount,
                    intent: paper.intent
                };
                console.log('처리된 영향력 있는 논문:', JSON.stringify(result, null, 2));
                return result;
            });
    }

    extractArxivId(url: string): string | null {
        const match = url.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
        return match ? match[1] : null;
    }

    async insertMetadata(metadata: ArxivMetadataType, file: TFile) {
        if (file) {
            try {
                // @ts-ignore
                const metaedit = this.app.plugins.plugins['metaedit'];
                if (!metaedit) {
                    new Notice('metaedit 플러그인이 설치되어 있지 않습니다.');
                    return;
                }

                const { update } = metaedit.api;

                const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};

                const updatedFrontmatter = {
                    ...frontmatter,
                    title: metadata.title || frontmatter.title,
                    paper_link: metadata.paperLink || frontmatter.paper_link,
                    publish_date: metadata.publishDate || frontmatter.publish_date,
                    authors: metadata.authors || frontmatter.authors,
                    num_cited_by: metadata.numCitedBy || 0,
                    num_citing: metadata.numCiting || 0,
                    checked: frontmatter.hasOwnProperty('checked') ? frontmatter.checked : false,
                    interest: frontmatter.hasOwnProperty('interest') ? frontmatter.interest : null,
                    rating: frontmatter.hasOwnProperty('rating') ? frontmatter.rating : null,
                    tags: frontmatter.hasOwnProperty('tags') ? frontmatter.tags : null
                };

                await this.app.fileManager.processFrontMatter(file, fm => {
                    Object.assign(fm, updatedFrontmatter);
                });

                let content = await this.app.vault.read(file);

                if (!content.includes("## Abstract")) {
                    const abstractContent = `## Abstract\n${metadata.abstract}\n`;
                    if (content.trim() === "") {
                        content = abstractContent.trim();
                    } else {
                        content = content.trim() + "\n\n" + abstractContent;
                    }
                }

                content = content.replace(/^\n+/, '').replace(/\n+$/, '');

                await this.app.vault.modify(file, content);

                const finalContent = await this.app.vault.read(file);
                const cleanedContent = finalContent.replace(/^---\n([\s\S]*?)\n---\n\n+/, '---\n$1\n---\n');
                await this.app.vault.modify(file, cleanedContent);

                // 파일 이름 변경
                await this.renameFile(file, metadata.title);

                // 사용자에게 관련 논문 파일 생성 여부를 묻는 모달 표시
                new CreateRelatedPapersModal(this.app, async (result) => {
                    const updatedContent = await this.app.vault.read(file);
                    let newContent = updatedContent;

                    if (!newContent.includes("## Influential Papers Cited By")) {
                        newContent += '\n\n## Influential Papers Cited By\n\n' + 
                            (result ? this.createLinksToInfluentialPapers(metadata.influentialCitations, file)
                                    : (metadata.influentialCitations && metadata.influentialCitations.length > 0 
                                        ? metadata.influentialCitations.map(paper => `- ${paper.title}\n`).join('')
                                        : '정보가 없습니다.\n'));
                    }

                    if (!newContent.includes("## Influential Papers Citing")) {
                        newContent += '\n\n## Influential Papers Citing\n\n' + 
                            (result ? this.createLinksToInfluentialPapers(metadata.influentialReferences, file)
                                    : (metadata.influentialReferences && metadata.influentialReferences.length > 0 
                                        ? metadata.influentialReferences.map(paper => `- ${paper.title}\n`).join('')
                                        : '정보가 없습니다.\n'));
                    }

                    if (newContent !== updatedContent) {
                        await this.app.vault.modify(file, newContent);
                    }

                    new Notice('메타데이터가 성공적으로 삽입되었습니다.');
                }).open();

            } catch (error) {
                console.error('메타데이터 삽입 오류:', error);
                new Notice('메타데이터 삽입 중 오류가 발생했습니다.');
            }
        } else {
            new Notice('메타데이터를 삽입할 파일을 찾을 수 없습니다.');
        }
    }

    private async insertInfluentialPapers(file: TFile, citedBy: any[] | undefined, citing: any[] | undefined) {
        let content = await this.app.vault.read(file);
        
        content += '\n\n## Influential Papers Cited By\n\n';
        if (citedBy && citedBy.length > 0) {
            content += this.createLinksToInfluentialPapers(citedBy, file);
        } else {
            content += '정보가 없습니다.\n';
        }
        
        content += '\n\n## Influential Papers Citing\n\n';
        if (citing && citing.length > 0) {
            content += this.createLinksToInfluentialPapers(citing, file);
        } else {
            content += '정보가 없습니다.\n';
        }

        await this.app.vault.modify(file, content);
    }

    private async insertInfluentialPapersLinks(file: TFile, citedBy: any[] | undefined, citing: any[] | undefined) {
        let content = await this.app.vault.read(file);
        
        content += '\n\n## Influential Papers Cited By\n\n';
        if (citedBy && citedBy.length > 0) {
            content += citedBy.map(paper => `- ${paper.title}\n`).join('');
        } else {
            content += '정보가 없습니다.\n';
        }
        
        content += '\n\n## Influential Papers Citing\n\n';
        if (citing && citing.length > 0) {
            content += citing.map(paper => `- ${paper.title}\n`).join('');
        } else {
            content += '정보가 없습니다.\n';
        }

        await this.app.vault.modify(file, content);
    }

    private createLinksToInfluentialPapers(papers: any[] | undefined, currentFile: TFile): string {
        if (!papers || papers.length === 0) {
            return '정보가 없습니다.\n';
        }
        return papers.map(paper => {
            const sanitizedTitle = this.sanitizeFileName(paper.title);
            const newFileName = `${sanitizedTitle}.md`;
            const newFilePath = currentFile.parent 
                ? `${currentFile.parent.path}/${newFileName}`
                : newFileName;
            
            this.createPaperFile(newFilePath, paper);
            
            return `- [[${sanitizedTitle}]]\n`;
        }).join('');
    }

    private async createPaperFile(filePath: string, paper: any) {
        const content = this.formatPaperContent(paper);
        await this.app.vault.create(filePath, content);
    }

    private formatPaperContent(paper: any): string {
        let paperLink = '';
        let semanticScholarLink = paper.url || '#';

        if (paper.arxivId) {
            paperLink = `https://arxiv.org/abs/${paper.arxivId}`;
        }

        return `---
title: "${paper.title}"
authors: "${paper.authors || 'N/A'}"
year: ${paper.year || 'N/A'}
venue: "${paper.venue || 'N/A'}"
paper_link: "${paperLink}"
semanticscholar_link: "${semanticScholarLink}"
arxiv_id: "${paper.arxivId || 'N/A'}"
doi: "${paper.doi || 'N/A'}"
citations: ${paper.citationCount || 'N/A'}
intent: ${JSON.stringify(paper.intent || [])}
---`;
    }

    private sanitizeFileName(fileName: string): string {
        // ':' '\' '/' 문자를 '_'로 대체
        return fileName.replace(/[:\/\\]/g, '_');
    }

    private async renameFile(file: TFile, newTitle: string) {
        if (!newTitle) return;

        const sanitizedTitle = this.sanitizeFileName(newTitle);
        let newPath: string;

        if (file.parent) {
            newPath = `${file.parent.path}/${sanitizedTitle}.md`;
        } else {
            // 파일이 루트 디렉토리에 있는 경우
            newPath = `${sanitizedTitle}.md`;
        }

        try {
            await this.app.fileManager.renameFile(file, newPath);
            new Notice(`파일 이름이 변경되었습니다: ${sanitizedTitle}`);
        } catch (error) {
            console.error('파일 이름 변경 오류:', error);
            new Notice('파일 이름 변경 중 오류가 발생했습니다.');
        }
    }

    private objectToYaml(obj: any): string {
        return Object.entries(obj)
            .map(([key, value]) => {
                if (value === null || value === undefined || value === '') {
                    return `${key}:`;
                }
                if (Array.isArray(value)) {
                    return `${key}: [${value.join(', ')}]`;
                }
                if (typeof value === 'string' && (value.includes('\n') || value.includes(':'))) {
                    return `${key}: |\n  ${value.replace(/\n/g, '\n  ')}`;
                }
                return `${key}: ${value}`;
            })
            .join('\n');
    }
}

interface ArxivMetadataType {
    title: string;
    paperLink: string;
    publishDate: string;
    authors: string;
    abstract: string;
    numCitedBy?: number;
    numCiting?: number;
    influentialCitations?: any[];
    influentialReferences?: any[];
}

class CreateRelatedPapersModal extends Modal {
    result: boolean;
    onSubmit: (result: boolean) => void;

    constructor(app: App, onSubmit: (result: boolean) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const {contentEl} = this;

        contentEl.createEl("h1", {text: "관련 논문 파일 생성"});

        new Setting(contentEl)
            .setName("연관된 인용 논문들을 새로운 파일로 작성하시겠습니까?")
            .addButton((btn) =>
                btn
                    .setButtonText("Yes")
                    .setCta()
                    .onClick(() => {
                        this.close();
                        this.onSubmit(true);
                    }))
            .addButton((btn) =>
                btn
                    .setButtonText("No")
                    .onClick(() => {
                        this.close();
                        this.onSubmit(false);
                    }));
    }

    onClose() {
        let {contentEl} = this;
        contentEl.empty();
    }
}