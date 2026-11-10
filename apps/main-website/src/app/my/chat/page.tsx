import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Chat" };

/**
 * A placeholder, and deliberately nothing more.
 *
 * There is no chat in this product yet: no table, no endpoint, no messages to show. This page
 * exists so the Chat item in the dashboard reaches somewhere that says so plainly, rather than a
 * 404 or a convincing-looking empty inbox that would imply messages could already arrive.
 *
 * When messaging is built, this file is replaced by the real thing.
 */
export default function ChatPage() {
  return (
    <>
      <div className="border-b border-line pb-5">
        <h1 className="text-3xl font-black tracking-tight text-brand-800">Chat</h1>
        <p className="mt-2 text-muted">Messages between you and the businesses you contact.</p>
      </div>

      <div className="mt-8">
        <EmptyState mark="&#128172;" title="Chat &ndash; Under Construction">
          <p>
            We&rsquo;re working on bringing you a better way to connect with businesses. Chat will be
            available soon!
          </p>
          <p className="mt-3">
            In the meantime, you can reach a business from its page &mdash; call it, or send it an
            enquiry.
          </p>
        </EmptyState>

        <div className="mt-6 text-center">
          <ButtonLink tone="cta" href="/search">
            Find a business <span aria-hidden="true">&rarr;</span>
          </ButtonLink>
        </div>
      </div>
    </>
  );
}
