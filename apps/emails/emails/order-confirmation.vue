<template>
  <Layout class="bg-[#f4eee5] font-hanken-grotesk">
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
    <Preheader>Your Alojamento Ideal stay is confirmed. Keep this email for dates, payment and reservation details.</Preheader>

    <Container class="max-w-[680px] mx-auto px-5 py-8 sm:px-4">
      <Section class="bg-[#5d473d] px-8 py-7 sm:px-6">
        <table cellpadding="0" cellspacing="0" class="w-full" role="presentation">
          <tr>
            <td class="w-[58px] align-middle">
              <Img
                src="https://alojamentoideal.pt/alojamento-ideal-logo.png"
                alt="Alojamento Ideal"
                width="50"
                class="block"
              />
            </td>
            <td class="align-middle">
              <Text
                class="m-0 font-bricolage-grotesque text-[22px] leading-6 text-[#fffaf2]"
              >
                <Raw>__APP_NAME__</Raw>
              </Text>
              <Text class="m-0 mt-1 text-[12px] font-semibold uppercase tracking-[2px] text-[#dfcdbd]">
                Find your ideal stay.
              </Text>
            </td>
            <td class="text-right align-middle">
              <Text class="m-0 text-[12px] font-bold uppercase tracking-[2px] text-[#dfcdbd]">
                Confirmed
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      <Section class="bg-[#fffaf2] px-8 pt-10 pb-7 sm:px-6">
        <Text class="m-0 text-[12px] font-bold uppercase tracking-[2px] text-[#8f6f5b]">
          Reservation confirmed
        </Text>

        <Spacer class="h-4" />

        <Heading
          class="m-0 font-bricolage-grotesque text-[42px] font-semibold leading-[46px] text-[#2c211c] sm:text-[32px] sm:leading-[37px]"
        >
          Booking confirmed
        </Heading>

        <Spacer class="h-5" />

        <Text class="m-0 text-[16px] leading-7 text-[#5c514b]">
          Your reservation for <Raw>__ACCOMMODATION_TITLE__</Raw> is confirmed. The main details are below.
        </Text>

        <Spacer class="h-6" />

        <table cellpadding="0" cellspacing="0" class="w-full border-t border-b border-[#eadccd]" role="presentation">
          <tr>
            <td class="py-4 pr-4 align-top">
              <Text class="m-0 text-[11px] font-bold uppercase tracking-[1.7px] text-[#8f6f5b]">
                Reservation
              </Text>
              <Text class="m-0 mt-1 font-bricolage-grotesque text-[24px] leading-7 text-[#2c211c]">
                <Raw>__ORDER_NUMBER__</Raw>
              </Text>
            </td>
            <td class="py-4 pl-4 text-right align-top">
              <Text class="m-0 text-[11px] font-bold uppercase tracking-[1.7px] text-[#8f6f5b]">
                Total paid
              </Text>
              <Text class="m-0 mt-1 text-[24px] font-bold leading-7 text-[#2c211c]">
                <Raw>__TOTAL_PRICE__</Raw>
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      <Section class="bg-[#fffaf2]">
        <Img
          src="__ACCOMMODATION_IMAGE__"
          alt="Accommodation photo"
          width="680"
          class="block w-full max-w-full"
        />
      </Section>

      <Section class="bg-[#fffaf2] px-8 py-8 sm:px-6">
        <Heading
          level="2"
          class="m-0 font-bricolage-grotesque text-[28px] font-semibold leading-8 text-[#2c211c]"
        >
          <Raw>__ACCOMMODATION_TITLE__</Raw>
        </Heading>

        <Spacer class="h-6" />

        <table cellpadding="0" cellspacing="0" class="w-full" role="presentation">
          <tr>
            <td class="border-t border-[#eadccd] py-4 pr-4 align-top">
              <Text class="m-0 text-[11px] font-bold uppercase tracking-[1.7px] text-[#8f6f5b]">
                Check-in
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-semibold leading-6 text-[#2c211c]">
                <Raw>__CHECK_IN__</Raw>
              </Text>
            </td>
            <td class="border-t border-[#eadccd] py-4 pl-4 align-top">
              <Text class="m-0 text-[11px] font-bold uppercase tracking-[1.7px] text-[#8f6f5b]">
                Check-out
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-semibold leading-6 text-[#2c211c]">
                <Raw>__CHECK_OUT__</Raw>
              </Text>
            </td>
          </tr>
          <tr>
            <td class="border-t border-[#eadccd] py-4 pr-4 align-top">
              <Text class="m-0 text-[11px] font-bold uppercase tracking-[1.7px] text-[#8f6f5b]">
                Guests
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-semibold leading-6 text-[#2c211c]">
                <Raw>__GUESTS__</Raw>
              </Text>
            </td>
            <td class="border-t border-[#eadccd] py-4 pl-4 align-top">
              <Text class="m-0 text-[11px] font-bold uppercase tracking-[1.7px] text-[#8f6f5b]">
                Payment
              </Text>
              <Text class="m-0 mt-1 text-[16px] font-semibold leading-6 text-[#2c211c]">
                <Raw>__PAYMENT_METHOD__</Raw><Raw>__CARD_LAST_FOUR__</Raw>
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      <Section class="bg-[#efe3d5] px-8 py-8 sm:px-6">
        <table cellpadding="0" cellspacing="0" class="w-full" role="presentation">
          <tr>
            <td class="align-top">
              <Text class="m-0 text-[12px] font-bold uppercase tracking-[2px] text-[#8f6f5b]">
                What happens next
              </Text>
              <Text class="m-0 mt-2 text-[15px] leading-6 text-[#5c514b]">
                We will send arrival guidance before check-in.
              </Text>
            </td>
          </tr>
        </table>

        <Spacer class="h-6" />

        <table cellpadding="0" cellspacing="0" class="w-full border-t border-[#d9c8b7]" role="presentation">
          <tr>
            <td class="py-4 pr-4 align-top">
              <Text class="m-0 text-[11px] font-bold uppercase tracking-[1.7px] text-[#8f6f5b]">
                Email on file
              </Text>
              <Text class="m-0 mt-1 break-all text-[15px] leading-6 text-[#2c211c]">
                <Raw>__CONTACT_EMAIL__</Raw>
              </Text>
            </td>
          </tr>
          <tr>
            <td class="border-t border-[#d9c8b7] py-4 pr-4 align-top">
              <Text class="m-0 text-[11px] font-bold uppercase tracking-[1.7px] text-[#8f6f5b]">
                Phone on file
              </Text>
              <Text class="m-0 mt-1 text-[15px] leading-6 text-[#2c211c]">
                <Raw>__CONTACT_PHONE__</Raw>
              </Text>
            </td>
          </tr>
          <tr>
            <td class="border-t border-[#d9c8b7] py-4 pr-4 align-top">
              <Text class="m-0 text-[11px] font-bold uppercase tracking-[1.7px] text-[#8f6f5b]">
                Billing address
              </Text>
              <Text class="m-0 mt-1 text-[15px] leading-6 text-[#2c211c]">
                <Raw>__BILLING_ADDRESS__</Raw>
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      <Section class="bg-[#fffaf2] px-8 py-8 sm:px-6">
        <table cellpadding="0" cellspacing="0" class="w-full" role="presentation">
          <tr>
            <td class="align-middle">
              <Text class="m-0 text-[12px] font-bold uppercase tracking-[2px] text-[#8f6f5b]">
                Reservation link
              </Text>
              <Text class="m-0 mt-2 text-[15px] leading-6 text-[#5c514b]">
                Open your reservation to check the details.
              </Text>
            </td>
          </tr>
          <tr>
            <td class="pt-6">
              <Button
                href="__MANAGE_URL__"
                variant="solid"
                class="bg-[#2c211c] px-7 py-4 text-[15px] font-bold text-[#fffaf2] no-underline rounded-[24px]"
              >
                Manage reservation
              </Button>
            </td>
          </tr>
        </table>

        <Spacer class="h-6" />

        <Text class="m-0 text-[13px] leading-5 text-[#81746d]">
          If the button does not work, paste this link into your browser:
        </Text>
        <Text class="m-0 mt-2 break-all text-[13px] leading-5 text-[#5d473d]">
          <Raw>__MANAGE_URL__</Raw>
        </Text>
      </Section>

      <Section class="bg-[#2c211c] px-8 py-7 sm:px-6">
        <Text class="m-0 text-[13px] leading-5 text-[#e8d9c8]">
          <Raw>__APP_NAME__</Raw> manages its own apartments and selected local activities on Portugal's North Coast.
        </Text>
        <Text class="m-0 mt-3 text-[12px] font-semibold uppercase tracking-[1.5px] text-[#bba694]">
          Porto | Póvoa de Varzim | Leça da Palmeira | Canidelo
        </Text>
        <Text class="m-0 mt-5 text-[12px] text-[#9f8c7e]">
          &copy; <Raw>__CURRENT_YEAR__</Raw> <Raw>__APP_NAME__</Raw>
        </Text>
      </Section>
    </Container>
  </Layout>
</template>
