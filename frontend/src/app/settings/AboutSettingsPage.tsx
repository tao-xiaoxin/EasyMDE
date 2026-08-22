import {
	createElement,
	createPortal,
	useEffect,
	useRef,
	useState,
} from "@wordpress/element";
import type { SettingsCenterBootstrap } from "../../contracts/bootstrap/settings-center-bootstrap";
import {
	BookOpen,
	ChevronRight,
	CircleCheck,
	Code2,
	ExternalLink,
	Github,
	Handshake,
	Heart,
	Info,
	MessageSquare,
	Pencil,
	Shield,
	Star,
	X,
} from "../../generated/lucide-icons";
import {
	DocumentIcon,
	ImageLibraryIcon,
	ImportExportIcon,
	KeyboardIcon,
} from "./settings-center-icons";
import { useDialogFocusTrap } from "./settings-center-utils";

type Strings = SettingsCenterBootstrap["strings"];
type DialogKind = "help" | "changelog";

export function AboutDialog({
	kind,
	onClose,
	strings,
	documentationUrl,
}: {
	kind: DialogKind;
	onClose: () => void;
	strings: Strings;
	documentationUrl: string;
}) {
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const help = kind === "help";

	useDialogFocusTrap(dialogRef, closeButtonRef);

	return (
		<div
			className="easymde-settings-center__transfer-dialog-layer"
			role="presentation"
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="easymde-about-dialog-title"
				className="easymde-settings-center__transfer-dialog easymde-settings-center__about-dialog"
			>
				<header>
					<span>
						{help ? <BookOpen size={20} /> : <DocumentIcon size={20} />}
					</span>
					<div>
						<h2 id="easymde-about-dialog-title">
							{help ? strings.aboutHelpDialogTitle : strings.aboutChangelog}
						</h2>
						<p>
							{help
								? strings.aboutHelpDialogDescription
								: strings.aboutChangelogDescription}
						</p>
					</div>
					<button
						ref={closeButtonRef}
						type="button"
						aria-label={strings.aboutCloseOperationDialog}
						onClick={onClose}
					>
						<X size={20} />
					</button>
				</header>
				<div
					className={`easymde-settings-center__transfer-dialog-body ${help ? "is-help" : "is-changelog"}`}
				>
					{help ? (
						<div className="easymde-settings-center__about-help-list">
							{[
								[
									strings.aboutHelpQuickStart,
									strings.aboutHelpQuickStartDescription,
								],
								[
									strings.aboutHelpEditorWorkflow,
									strings.aboutHelpEditorWorkflowDescription,
								],
								[
									strings.aboutHelpConfigurationMigration,
									strings.aboutHelpConfigurationMigrationDescription,
								],
							].map(([title, description]) => (
								<div key={title}>
									<CircleCheck size={18} />
									<div>
										<strong>{title}</strong>
										<p>{description}</p>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="easymde-settings-center__about-changelog-list">
							{[
								{
									version: strings.aboutCurrentVersionValue,
									date: strings.aboutVersion018Date,
									current: true,
									changes: [
										strings.aboutVersion018ChangeReact,
										strings.aboutVersion018ChangeEditor,
										strings.aboutVersion018ChangeNative,
									],
								},
								{
									version: strings.aboutVersion017,
									date: strings.aboutVersion017Date,
									current: false,
									changes: [
										strings.aboutVersion017ChangeToolbar,
										strings.aboutVersion017ChangeShortcuts,
									],
								},
							].map((release) => (
								<section key={release.version}>
									<div>
										<strong>v{release.version}</strong>
										<span>{release.date}</span>
										{release.current ? (
											<small>{strings.aboutCurrentVersionBadge}</small>
										) : null}
									</div>
									<ul>
										{release.changes.map((change) => (
											<li key={change}>
												<i />
												{change}
											</li>
										))}
									</ul>
								</section>
							))}
						</div>
					)}
				</div>
				<footer>
					{help ? (
						<a
							href={documentationUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="is-primary-action"
						>
							<ExternalLink size={15} />
							{strings.aboutOpenFullDocumentation}
						</a>
					) : null}
					<button type="button" onClick={onClose}>
						{strings.aboutClose}
					</button>
				</footer>
			</div>
		</div>
	);
}

export function AboutSettingsPage({
	overlayRoot,
	bootstrap,
}: {
	overlayRoot: HTMLElement | null;
	bootstrap: SettingsCenterBootstrap;
}) {
	const { strings, links } = bootstrap;
	const [dialog, setDialog] = useState<DialogKind | null>(null);
	const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (!dialog) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setDialog(null);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [dialog]);

	useEffect(() => {
		if (dialog) return;
		dialogTriggerRef.current?.focus();
		dialogTriggerRef.current = null;
	}, [dialog]);

	const openDialog = (kind: DialogKind, trigger: HTMLButtonElement) => {
		dialogTriggerRef.current = trigger;
		setDialog(kind);
	};
	const dialogPortal =
		dialog && overlayRoot
			? createPortal(
					<AboutDialog
						kind={dialog}
						strings={strings}
						documentationUrl={links.documentationUrl}
						onClose={() => setDialog(null)}
					/>,
					overlayRoot,
				)
			: null;

	const capabilities = [
		{ icon: Pencil, label: strings.aboutMarkdownPreview },
		{ icon: Code2, label: strings.aboutCodeHighlighting },
		{ icon: ImageLibraryIcon, label: strings.aboutImageUpload },
		{ icon: KeyboardIcon, label: strings.aboutShortcutWorkflow },
		{ icon: ImportExportIcon, label: strings.aboutConfigurationMigration },
	];
	const resources = [
		{
			icon: BookOpen,
			label: strings.aboutOfficialDocumentation,
			meta: "",
			href: links.documentationUrl,
			dialog: "help" as const,
		},
		{
			icon: DocumentIcon,
			label: strings.aboutChangelog,
			meta: "",
			href: links.releasesUrl,
			dialog: "changelog" as const,
		},
		{
			icon: MessageSquare,
			label: strings.aboutIssueFeedback,
			meta: "",
			href: links.issuesUrl,
		},
		{
			icon: Github,
			label: strings.aboutGithubRepository,
			meta: "",
			href: links.projectUrl,
			github: true,
		},
		{
			icon: Shield,
			label: strings.aboutSecurityPolicy,
			meta: "SECURITY.md",
			href: links.securityUrl,
		},
		{
			icon: Shield,
			label: strings.aboutOpenSourceLicense,
			meta: "Apache-2.0",
			href: links.licenseUrl,
		},
	];

	return (
		<div className="easymde-settings-center__about-page">
			<section className="easymde-settings-center__about-group is-version">
				<h2>
					<Info size={28} strokeWidth={1.8} />
					{strings.aboutVersionInformation}
				</h2>
				<div className="easymde-settings-center__about-version-list">
					<div>
						<strong>{strings.aboutCurrentVersion}</strong>
						<span>
							<span>{strings.aboutCurrentVersionValue}</span>
							<a
								href={links.releasesUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								<ExternalLink size={14} />
								{strings.aboutCheckUpdates}
							</a>
						</span>
					</div>
					{[
						[strings.aboutRenderEngine, strings.aboutRenderEngineValue],
						[
							strings.aboutCompatibleVersion,
							strings.aboutCompatibleVersionValue,
						],
						[strings.aboutPhpRequirement, strings.aboutPhpRequirementValue],
					].map(([label, value]) => (
						<div key={label}>
							<strong>{label}</strong>
							<span>{value}</span>
						</div>
					))}
				</div>
			</section>

			<section className="easymde-settings-center__about-group is-capabilities">
				<h2>
					<Star size={28} strokeWidth={1.8} />
					{strings.aboutCoreCapabilities}
				</h2>
				<div className="easymde-settings-center__about-capability-list">
					{capabilities.map(({ icon: Icon, label }) => (
						<div key={label}>
							<Icon size={24} />
							{label}
						</div>
					))}
				</div>
			</section>

			<section className="easymde-settings-center__about-group is-resources">
				<h2>
					<Handshake size={28} strokeWidth={1.8} />
					{strings.aboutResourcesSupport}
				</h2>
				<div className="easymde-settings-center__about-resource-list">
					{resources.map(
						({
							icon: Icon,
							label,
							meta,
							href,
							github,
							dialog: resourceDialog,
						}) => {
							const content = [
								<Icon
									key="icon"
									size={20}
									className={github ? "is-github" : undefined}
								/>,
								<span key="label">{label}</span>,
								meta ? <small key="meta">{meta}</small> : null,
								resourceDialog ? (
									<ChevronRight key="action" size={17} />
								) : (
									<ExternalLink key="action" size={15} />
								),
							];
							return resourceDialog ? (
								<button
									type="button"
									key={label}
									onClick={(event) =>
										openDialog(resourceDialog, event.currentTarget)
									}
								>
									{content}
								</button>
							) : (
								<a
									href={href}
									target="_blank"
									rel="noopener noreferrer"
									key={label}
								>
									{content}
								</a>
							);
						},
					)}
				</div>
				<div className="easymde-settings-center__about-support-note">
					<Heart size={20} />
					{strings.aboutSupportNote}
				</div>
			</section>

			<section className="easymde-settings-center__about-group is-introduction">
				<h2>
					<BookOpen size={28} strokeWidth={1.8} />
					{strings.aboutPluginIntroduction}
				</h2>
				<p>{strings.aboutPluginIntroductionDescription}</p>
				<div>
					{[
						strings.aboutTagMarkdown,
						strings.aboutTagLivePreview,
						strings.aboutTagImages,
						strings.aboutTagLocalAssets,
						strings.aboutTagShortcuts,
					].map((tag) => (
						<span key={tag}>{tag}</span>
					))}
				</div>
			</section>
			{dialogPortal}
		</div>
	);
}
