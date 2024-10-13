import { App, Plugin, PluginSettingTab, Setting, TFolder, FuzzySuggestModal, FuzzyMatch } from 'obsidian';
import { ArxivSummarizer } from './summarizer';
import { ArxivMetadata } from './metadata';
import { ArxivSearch } from './search';
import { PaperDownloader } from './download_pdf_paper_link';

interface MyPluginSettings {
    openaiApiKey: string;
    translate: boolean;
    targetLanguage: string;
    paperPaths: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    openaiApiKey: '',
    translate: false,
    targetLanguage: '한국어',
    paperPaths: ''
}

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;
    summarizer: ArxivSummarizer;
    metadata: ArxivMetadata;
    search: ArxivSearch;
    paperDownloader: PaperDownloader;

    async onload() {
        await this.loadSettings();

        this.summarizer = new ArxivSummarizer(this.app, this);
        this.metadata = new ArxivMetadata(this.app, this);
        this.search = new ArxivSearch(this.app, this);

        console.log('Creating PaperDownloader instance');
        this.paperDownloader = new PaperDownloader(this.app, this);

        this.addRibbonIcon('dice', 'Arxiv Summarization', () => {
            this.summarizer.summarizeFromClipboard();
        });

        this.addCommand({
            id: 'open-arxiv-summarization-modal',
            name: 'Arxiv 논문 OpenAI API 이용하여 요약하기',
            callback: () => {
                this.summarizer.summarizeFromClipboard();
            }
        });

        this.addCommand({
            id: 'fetch-arxiv-metadata',
            name: 'Arxiv 메타데이터 가져오기',
            callback: () => {
                this.metadata.fetchMetadataFromClipboard();
            }
        });

        this.addCommand({
            id: 'search-arxiv',
            name: '선택된 텍스트로 Arxiv 검색하여 MetaData 가져오고 새로운 파일 작성하기',
            callback: () => {
                this.search.searchArxiv();
            }
        });

        this.addCommand({
            id: 'download-paper',
            name: 'Download Paper PDF',
            callback: () => {
                console.log('Download Paper command triggered');
                this.paperDownloader.downloadPaper();
            }
        });

        this.addSettingTab(new MyPluginSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class MyPluginSettingTab extends PluginSettingTab {
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

        new Setting(containerEl)
            .setName('Paper Download Paths')
            .setDesc('Specify the paths to download papers')
            .addText(text => text
                .setPlaceholder('path/to/papers')
                .setValue(this.plugin.settings.paperPaths)
                .onChange(async (value) => {
                    this.plugin.settings.paperPaths = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Select Folder')
                .onClick(() => {
                    new FolderSuggestModal(this.app, (folder) => {
                        const path = folder.path;
                        this.plugin.settings.paperPaths = path;
                        this.plugin.saveSettings();
                        this.display(); // 설정 화면을 새로고침합니다.
                    }).open();
                }));
    }
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    onChooseItem: (folder: TFolder) => void;

    constructor(app: App, onChooseItem: (folder: TFolder) => void) {
        super(app);
        this.onChooseItem = onChooseItem;
    }

    getItems(): TFolder[] {
        return this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder);
    }

    getItemText(folder: TFolder): string {
        return folder.path;
    }

    onChooseSuggestion(item: FuzzyMatch<TFolder>, evt: MouseEvent | KeyboardEvent): void {
        this.onChooseItem(item.item);
    }
}
