/**
 * Consent-version-bump — English.
 *
 * See nl.tsx header for context on consent-version bumps.
 */
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components';

export const subject = 'Updated terms';

interface Props {
  oldVersion: string;
  newVersion: string;
  category: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  operational: 'Operational data',
  medical_processing: 'Medical data processing',
  photo_video: 'Photo and video use',
};

export default function ConsentVersionBumpEn({ oldVersion, newVersion, category }: Props) {
  const label = CATEGORY_LABELS[category] ?? category;
  return (
    <Html lang="en">
      <Head />
      <Preview>Updated terms for VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Updated terms</Heading>
          <Text>
            We have updated the terms for <strong>{label}</strong>. The previous version
            ({oldVersion}) has been replaced with version {newVersion}.
          </Text>
          <Text>
            Sign in to VTTL Topsport to review the new version and re-confirm your
            consent. Some features remain limited until you do.
          </Text>
          <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            VTTL — Flemish Table Tennis League · vttl.be
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
