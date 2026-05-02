/**
 * Consent-version-bump — Français.
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

export const subject = 'Conditions mises à jour';

interface Props {
  oldVersion: string;
  newVersion: string;
  category: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  operational: 'Données opérationnelles',
  medical_processing: 'Traitement des données médicales',
  photo_video: 'Utilisation de photos et vidéos',
};

export default function ConsentVersionBumpFr({ oldVersion, newVersion, category }: Props) {
  const label = CATEGORY_LABELS[category] ?? category;
  return (
    <Html lang="fr">
      <Head />
      <Preview>Conditions mises à jour pour VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Conditions mises à jour</Heading>
          <Text>
            Nous avons mis à jour les conditions concernant{' '}
            <strong>{label}</strong>. La version précédente ({oldVersion}) a été
            remplacée par la version {newVersion}.
          </Text>
          <Text>
            Connectez-vous à VTTL Topsport pour consulter la nouvelle version et
            reconfirmer votre consentement. Certaines fonctionnalités resteront limitées
            tant que vous ne l&apos;aurez pas fait.
          </Text>
          <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            VTTL — Ligue Flamande de Tennis de Table · vttl.be
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
