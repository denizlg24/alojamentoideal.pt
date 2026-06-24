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
    <Preheader>Reset your Alojamento Ideal password.</Preheader>

    <Container class="max-w-[620px] mx-auto px-5 py-8 sm:px-4">
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
          </tr>
        </table>
      </Section>

      <Section class="bg-[#fffaf2] px-8 py-10 sm:px-6">
        <Text class="m-0 text-[12px] font-bold uppercase tracking-[2px] text-[#8f6f5b]">
          Password reset
        </Text>

        <Spacer class="h-4" />

        <Heading
          class="m-0 font-bricolage-grotesque text-[36px] font-semibold leading-[40px] text-[#2c211c] sm:text-[30px] sm:leading-[35px]"
        >
          Reset your password
        </Heading>

        <Spacer class="h-5" />

        <Text class="m-0 text-[16px] leading-7 text-[#5c514b]">
          We received a request to reset your <Raw>__APP_NAME__</Raw> password. Use the button below to choose a new one.
        </Text>

        <Spacer class="h-7" />

        <Button
          href="__RESET_URL__"
          variant="solid"
          class="bg-[#2c211c] px-7 py-4 text-[15px] font-bold text-[#fffaf2] no-underline rounded-[24px]"
        >
          Reset password
        </Button>

        <Spacer class="h-6" />

        <Text class="m-0 text-[14px] leading-6 text-[#7a6b62]">
          This link expires in 15 minutes. If you did not ask for a reset, you can ignore this email.
        </Text>

        <Spacer class="h-8" />

        <Hr class="m-0 border-[#eadccd]" />

        <Spacer class="h-5" />

        <Text class="m-0 text-[13px] leading-5 text-[#81746d]">
          If the button does not work, paste this link into your browser:
        </Text>
        <Text class="m-0 mt-2 break-all text-[13px] leading-5 text-[#5d473d]">
          <Raw>__RESET_URL__</Raw>
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
