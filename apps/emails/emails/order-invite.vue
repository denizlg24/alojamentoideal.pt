<template>
  <Layout class="bg-[#efe7d9] font-hanken-grotesk">
    <Font
      family="Hanken Grotesk"
      fallback="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
      :weights="[400, 500, 600, 700]"
    />
    <Font
      family="Bricolage Grotesque"
      fallback="'Hanken Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
      :weights="[400, 500, 600, 700]"
    />
    <Preheader>You've been invited to join an Alojamento Ideal booking.</Preheader>

    <Container class="max-w-[560px] mx-auto px-6 py-10 sm:px-4">
      <Section class="px-2 pb-8">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td class="w-[34px] align-middle">
              <Img
                src="https://alojamentoideal.pt/alojamento-ideal-logo.png"
                alt="Alojamento Ideal"
                width="28"
                class="block"
              />
            </td>
            <td class="pl-3 align-middle">
              <Text class="m-0 font-bricolage-grotesque text-[17px] leading-5 text-[#2b211b]">
                <Raw>__APP_NAME__</Raw>
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      <Section class="bg-[#fffdf9] px-9 pt-11 pb-10 rounded-[20px] sm:px-6">
        <Text class="m-0 text-[13px] font-semibold leading-5 text-[#b4512c]">
          Booking invite
        </Text>

        <Spacer class="h-4" />

        <Heading
          class="m-0 font-bricolage-grotesque text-[34px] font-semibold leading-[38px] text-[#2b211b] sm:text-[28px] sm:leading-[32px]"
        >
          You've been invited.
        </Heading>

        <Spacer class="h-5" />

        <Text class="m-0 text-[16px] leading-7 text-[#6a5d52]">
          Someone has invited you to join booking <Raw>__ORDER_NUMBER__</Raw> for <Raw>__ACCOMMODATION_TITLE__</Raw> with <Raw>__APP_NAME__</Raw>.
        </Text>

        <Spacer class="h-7" />

        <table cellpadding="0" cellspacing="0" class="w-full border-t border-b border-[#ece1cf]" role="presentation">
          <tr>
            <td class="py-4 pr-4 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Reservation
              </Text>
              <Text class="m-0 mt-1 font-bricolage-grotesque text-[22px] leading-7 text-[#2b211b]">
                <Raw>__ORDER_NUMBER__</Raw>
              </Text>
            </td>
          </tr>
          <tr>
            <td class="border-t border-[#ece1cf] py-4 pr-4 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Stay
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-medium leading-6 text-[#2b211b]">
                <Raw>__ACCOMMODATION_TITLE__</Raw>
              </Text>
            </td>
          </tr>
        </table>

        <Spacer class="h-8" />

        <Button
          href="__INVITE_URL__"
          variant="solid"
          class="bg-[#2b211b] px-7 py-4 text-[15px] font-semibold text-[#fffdf9] no-underline rounded-full"
        >
          Open booking &rarr;
        </Button>

        <Spacer class="h-6" />

        <Text class="m-0 text-[14px] leading-6 text-[#8a7c6f]">
          This link expires in <Raw>__EXPIRES_IN_HOURS__</Raw> hours. If it expires, ask the person who booked the stay to send a fresh invite.
        </Text>

        <Spacer class="h-7" />

        <Hr class="m-0 border-[#ece1cf]" />

        <Spacer class="h-5" />

        <Text class="m-0 text-[13px] leading-5 text-[#8a7c6f]">
          Trouble with the button? Paste this link into your browser:
        </Text>
        <Text class="m-0 mt-1 break-all text-[13px] leading-5 text-[#b4512c]">
          <Raw>__INVITE_URL__</Raw>
        </Text>
      </Section>

      <Section class="px-9 pt-8 pb-2 sm:px-6">
        <Text class="m-0 text-[13px] leading-6 text-[#8a7c6f]">
          <Raw>__APP_NAME__</Raw> owns and cares for its own apartments along Portugal's North Coast.
        </Text>
        <Text class="m-0 mt-2 text-[13px] leading-6 text-[#a3937f]">
          Porto &middot; Póvoa de Varzim &middot; Leça da Palmeira &middot; Canidelo
        </Text>
        <Text class="m-0 mt-4 text-[12px] leading-5 text-[#b3a690]">
          &copy; <Raw>__CURRENT_YEAR__</Raw> <Raw>__APP_NAME__</Raw>
        </Text>
      </Section>
    </Container>
  </Layout>
</template>
