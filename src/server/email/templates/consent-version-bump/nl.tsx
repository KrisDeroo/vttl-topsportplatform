/**
 * Consent-version-bump — Nederlands.
 *
 * Sent when a major version of consent text bumps (D-04..07; e.g. legal review
 * or Belgian DPA guideline update). The user is asked to re-acknowledge by
 * visiting the platform; the link itself is omitted from the email body so a
 * forwarded mail does not constitute consent.
 *
 * `category` is the canonical lookup code (`operational | medical_processing |
 * photo_video`); we map it to a human label here. Backend logs and the DB row
 * both retain the canonical code (I18N-11).
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

export const subject = 'Bijgewerkte voorwaarden';

interface Props {
  oldVersion: string;
  newVersion: string;
  category: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  operational: 'Operationele gegevens',
  medical_processing: 'Medische verwerking',
  photo_video: 'Foto- en videogebruik',
};

export default function ConsentVersionBumpNl({ oldVersion, newVersion, category }: Props) {
  const label = CATEGORY_LABELS[category] ?? category;
  return (
    <Html lang="nl">
      <Head />
      <Preview>Bijgewerkte voorwaarden voor VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Bijgewerkte voorwaarden</Heading>
          <Text>
            We hebben de voorwaarden voor <strong>{label}</strong> bijgewerkt. De vorige
            versie ({oldVersion}) is vervangen door versie {newVersion}.
          </Text>
          <Text>
            Log in op VTTL Topsport om de nieuwe versie te bekijken en je toestemming
            opnieuw te bevestigen. Tot je dit hebt gedaan, blijven sommige functies
            beperkt.
          </Text>
          <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            VTTL — Vlaamse Tafeltennis Liga · vttl.be
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
