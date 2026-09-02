import Section from '@components/section';
import Row from '@components/rowTsx';
import {IS_ELECTRON} from '@environment/userAgent';
import {i18n} from '@lib/langPack';

const GITHUB_URL = 'https://github.com/duckgram/duckgram';
const APP_NAME = 'Duckgram';
const APP_TECHNOLOGY = IS_ELECTRON
  ? 'TypeScript, Solid.js, MTProto, Vite, Electron, SCSS'
  : 'TypeScript, Solid.js, MTProto, Vite, SCSS';
const APP_VERSION = '1.0.1';

// Section name/caption are rendered as literal JSX (not via i18n), and row
// texts use i18n() keys defined in langCustom.ts so they follow the selected
// language. Keys fall back gracefully if a language pack is missing.
const InfoSection = () => (
  <Section name="AboutTab.Title">
    <Row>
      <Row.Title>{i18n('AboutTab.ProjectName')}</Row.Title>
      <Row.Subtitle>{APP_NAME}</Row.Subtitle>
    </Row>
    <Row>
      <Row.Title>{i18n('AboutTab.Technology')}</Row.Title>
      <Row.Subtitle>{APP_TECHNOLOGY}</Row.Subtitle>
    </Row>
    <Row>
      <Row.Title>{i18n('AboutTab.Version')}</Row.Title>
      <Row.Subtitle>{APP_VERSION}</Row.Subtitle>
    </Row>
    <Row>
      <Row.Title>{i18n('AboutTab.Status')}</Row.Title>
      <Row.Subtitle>{i18n('AboutTab.StatusPlaceholder')}</Row.Subtitle>
    </Row>
  </Section>
);

const GitHubSection = () => (
  <Section name="AboutTab.SourceCode">
    <Row clickable={() => window.open(GITHUB_URL, '_blank', 'noopener')}>
      <Row.Icon icon="link" />
      <Row.Title>{i18n('AboutTab.OpenGitHub')}</Row.Title>
      <Row.Subtitle>{GITHUB_URL}</Row.Subtitle>
    </Row>
  </Section>
);

const AntiBlockSection = () => (
  <Section name="AboutTab.UniqueTech">
    <Row>
      <Row.Icon icon="lock" />
      <Row.Title>{i18n('AboutTab.UniqueTech')}</Row.Title>
      <Row.Subtitle>{i18n('AboutTab.TechDescription')}</Row.Subtitle>
    </Row>
  </Section>
);

const AboutTab = () => (
  <>
    <InfoSection />
    <GitHubSection />
    <AntiBlockSection />
  </>
);

export default AboutTab;
