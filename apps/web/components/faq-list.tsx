import { FAQS } from "../lib/marketing-content";

export function FaqList({ limit }: { limit?: number }) {
  const questions = limit ? FAQS.slice(0, limit) : FAQS;
  return (
    <div className="faq-list">
      {questions.map(({ question, answer }) => (
        <details key={question}>
          <summary>
            {question}
            <span aria-hidden="true">+</span>
          </summary>
          <p>{answer}</p>
        </details>
      ))}
    </div>
  );
}
