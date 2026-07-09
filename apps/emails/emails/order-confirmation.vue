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
    <Preheader>Your stay is confirmed. Dates, payment and reservation details are inside.</Preheader>

    <Container class="max-w-[600px] mx-auto px-6 py-10 sm:px-4">
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

      <Section class="bg-[#fffdf9] px-9 pt-11 pb-9 rounded-t-[20px] sm:px-6">
        <Text class="m-0 text-[13px] font-semibold leading-5 text-[#b4512c]">
          Reservation confirmed
        </Text>

        <Spacer class="h-4" />

        <Heading
          class="m-0 font-bricolage-grotesque text-[40px] font-semibold leading-[44px] text-[#2b211b] sm:text-[32px] sm:leading-[36px]"
        >
          You're all set.
        </Heading>

        <Spacer class="h-5" />

        <Text class="m-0 text-[16px] leading-7 text-[#6a5d52]">
          <Raw>__STAYS_INTRO__</Raw> Here is everything you need, all in one place.
        </Text>

        <Spacer class="h-8" />

        <table cellpadding="0" cellspacing="0" class="w-full border-t border-[#ece1cf]" role="presentation">
          <tr>
            <td class="py-4 pr-4 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Reservation
              </Text>
              <Text class="m-0 mt-1 font-bricolage-grotesque text-[22px] leading-7 text-[#2b211b]">
                <Raw>__ORDER_NUMBER__</Raw>
              </Text>
            </td>
            <td class="py-4 pl-4 text-right align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Total paid
              </Text>
              <Text class="m-0 mt-1 font-bricolage-grotesque text-[22px] font-semibold leading-7 text-[#b4512c]">
                <Raw>__TOTAL_PRICE__</Raw>
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      <Raw>__STAYS_START__</Raw>
      <Section class="bg-[#fffdf9]">
        <Img
          src="__STAY_IMAGE__"
          alt="Accommodation photo"
          width="600"
          class="block w-full max-w-full"
        />
      </Section>

      <Section class="bg-[#fffdf9] px-9 pt-9 pb-8 sm:px-6">
        <Heading
          level="2"
          class="m-0 font-bricolage-grotesque text-[24px] font-semibold leading-8 text-[#2b211b]"
        >
          <Raw>__STAY_TITLE__</Raw>
        </Heading>

        <Spacer class="h-6" />

        <table cellpadding="0" cellspacing="0" class="w-full" role="presentation">
          <tr>
            <td class="w-1/2 border-t border-[#ece1cf] py-4 pr-4 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Check-in
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-medium leading-6 text-[#2b211b]">
                <Raw>__STAY_CHECK_IN__</Raw>
              </Text>
            </td>
            <td class="w-1/2 border-t border-[#ece1cf] py-4 pl-4 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Check-out
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-medium leading-6 text-[#2b211b]">
                <Raw>__STAY_CHECK_OUT__</Raw>
              </Text>
            </td>
          </tr>
          <tr>
            <td class="border-t border-[#ece1cf] py-4 pr-4 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Guests
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-medium leading-6 text-[#2b211b]">
                <Raw>__STAY_GUESTS__</Raw>
              </Text>
            </td>
            <td class="border-t border-[#ece1cf] py-4 pl-4 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Nights
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-medium leading-6 text-[#2b211b]">
                <Raw>__STAY_NIGHTS__</Raw>
              </Text>
            </td>
          </tr>
        </table>
      </Section>
      <Raw>__STAYS_END__</Raw>

      <Raw>__ACTIVITIES_START__</Raw>
      <Section class="bg-[#fffdf9]">
        <Img
          src="__ACTIVITY_IMAGE__"
          alt="Activity photo"
          width="600"
          class="block w-full max-w-full"
        />
      </Section>

      <Section class="bg-[#fffdf9] px-9 pt-9 pb-8 sm:px-6">
        <Heading
          level="2"
          class="m-0 font-bricolage-grotesque text-[24px] font-semibold leading-8 text-[#2b211b]"
        >
          <Raw>__ACTIVITY_TITLE__</Raw>
        </Heading>

        <Spacer class="h-6" />

        <table cellpadding="0" cellspacing="0" class="w-full" role="presentation">
          <tr>
            <td class="w-1/2 border-t border-[#ece1cf] py-4 pr-4 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Date
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-medium leading-6 text-[#2b211b]">
                <Raw>__ACTIVITY_DATE__</Raw>
              </Text>
            </td>
            <td class="w-1/2 border-t border-[#ece1cf] py-4 pl-4 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Participants
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-medium leading-6 text-[#2b211b]">
                <Raw>__ACTIVITY_PARTICIPANTS__</Raw>
              </Text>
            </td>
          </tr>
        </table>
      </Section>
      <Raw>__ACTIVITIES_END__</Raw>

      <Section class="bg-[#fffdf9] px-9 pt-1 pb-8 sm:px-6">
        <Button
          href="__MANAGE_URL__"
          variant="solid"
          class="bg-[#2b211b] px-7 py-4 text-[15px] font-semibold text-[#fffdf9] no-underline rounded-full"
        >
          View your reservation &rarr;
        </Button>

        <Spacer class="h-6" />

        <Text class="m-0 text-[13px] leading-5 text-[#8a7c6f]">
          Trouble with the button? Paste this link into your browser:
        </Text>
        <Text class="m-0 mt-1 break-all text-[13px] leading-5 text-[#b4512c]">
          <Raw>__MANAGE_URL__</Raw>
        </Text>
      </Section>

      <Section class="bg-[#f7efe2] px-9 py-7 sm:px-6">
        <Text class="m-0 text-[13px] font-semibold leading-5 text-[#8a7c6f]">
          Before you arrive
        </Text>
        <Text class="m-0 mt-2 text-[15px] leading-6 text-[#6a5d52]">
          We will send arrival directions and check-in details a little closer to your stay.
        </Text>

        <Spacer class="h-6" />

        <table cellpadding="0" cellspacing="0" class="w-full border-t border-[#e3d5c1]" role="presentation">
          <tr>
            <td class="py-3 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Email on file
              </Text>
              <Text class="m-0 mt-1 break-all text-[15px] leading-6 text-[#2b211b]">
                <Raw>__CONTACT_EMAIL__</Raw>
              </Text>
            </td>
          </tr>
          <tr>
            <td class="border-t border-[#e3d5c1] py-3 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Phone on file
              </Text>
              <Text class="m-0 mt-1 text-[15px] leading-6 text-[#2b211b]">
                <Raw>__CONTACT_PHONE__</Raw>
              </Text>
            </td>
          </tr>
          <tr>
            <td class="border-t border-[#e3d5c1] py-3 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Billing address
              </Text>
              <Text class="m-0 mt-1 text-[15px] leading-6 text-[#2b211b]">
                <Raw>__BILLING_ADDRESS__</Raw>
              </Text>
            </td>
          </tr>
          <tr>
            <td class="border-t border-[#e3d5c1] py-3 align-top">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Payment
              </Text>
              <Text class="m-0 mt-1 text-[15px] leading-6 text-[#2b211b]">
                <Raw>__PAYMENT_METHOD__</Raw><Raw>__CARD_LAST_FOUR__</Raw>
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      <Section class="bg-[#fffdf9] px-9 py-8 rounded-b-[20px] sm:px-6">
        <Text class="m-0 text-[15px] leading-7 text-[#6a5d52]">
          Questions about your stay? Just reply to this email and a real person on our team will help.
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
