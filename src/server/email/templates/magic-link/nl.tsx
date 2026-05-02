/**
 * Magic-link — Nederlands.
 *
 * Magic-link login is deferred (CONTEXT.md §deferred). The template exists
 * now so future v1.1 enabling is a config change, not a content shipment.
 */
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export const subject = 'Je inloglink';

interface Props {
  loginUrl: string;
  expiresInMinutes: number;
}

export default function MagicLinkNl({ loginUrl, expiresInMinutes }: Props) {
  return (
    <Html lang="nl">
      <Head />
      <Preview>Je inloglink voor VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Je inloglink</Heading>
          <Text>
            Klik op de knop hieronder om in te loggen op VTTL Topsport. Je hoeft geen
            wachtwoord in te voeren.
          </Text>
          <Section style={{ margin: '24px 0' }}>
            <Link
              href={loginUrl}
              style={{
                background: '#0066cc',
                color: '#fff',
                padding: '12px 24px',
                textDecoration: 'none',
                borderRadius: 4,
                display: 'inline-block',
              }}
            >
              Aanmelden
            </Link>
          </Section>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Of kopieer deze link in je browser: {loginUrl}
          </Text>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Deze link is {expiresInMinutes} minuten geldig. Als je dit verzoek niet hebt
            gedaan, kun je deze e-mail negeren.
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
