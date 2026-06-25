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
    <Preheader>We could not confirm your booking, so we have refunded you in full.</Preheader>

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
          Full refund issued
        </Text>

        <Spacer class="h-4" />

        <Heading
          class="m-0 font-bricolage-grotesque text-[34px] font-semibold leading-[38px] text-[#2b211b] sm:text-[28px] sm:leading-[32px]"
        >
          We've refunded you in full.
        </Heading>

        <Spacer class="h-5" />

        <Text class="m-0 text-[16px] leading-7 text-[#6a5d52]">
          <Raw>__GREETING__</Raw>
        </Text>

        <Spacer class="h-3" />

        <Text class="m-0 text-[16px] leading-7 text-[#6a5d52]">
          We're sorry. We were unable to confirm booking <Raw>__ORDER_NUMBER__</Raw> for your stay, so we have cancelled it and refunded you in full.
        </Text>

        <Spacer class="h-7" />

        <table cellpadding="0" cellspacing="0" class="w-full border-t border-b border-[#ece1cf]" role="presentation">
          <tr>
            <td class="py-4 pr-4 align-middle">
              <Text class="m-0 text-[13px] leading-5 text-[#94826f]">
                Refund on its way
              </Text>
            </td>
            <td class="py-4 pl-4 text-right align-middle">
              <Text class="m-0 font-bricolage-grotesque text-[22px] font-semibold leading-7 text-[#b4512c]">
                <Raw>__REFUND_AMOUNT__</Raw>
              </Text>
            </td>
          </tr>
        </table>

        <Spacer class="h-5" />

        <Text class="m-0 text-[15px] leading-7 text-[#6a5d52]">
          It is heading back to your original payment method now and can take a few business days to appear, depending on your bank.
        </Text>

        <Spacer class="h-8" />

        <Button
          href="__BROWSE_URL__"
          variant="solid"
          class="bg-[#2b211b] px-7 py-4 text-[15px] font-semibold text-[#fffdf9] no-underline rounded-full"
        >
          Find another stay &rarr;
        </Button>

        <Spacer class="h-7" />

        <Hr class="m-0 border-[#ece1cf]" />

        <Spacer class="h-5" />

        <Text class="m-0 text-[14px] leading-6 text-[#8a7c6f]">
          Want help finding an alternative for the same dates? Just reply to this email and a real person on our team will help.
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
